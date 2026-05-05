import { type FSWatcher, watch } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@mariozechner/pi-tui";
import { Image, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

const PANEL_ID = "jupyter-preview";
const NOTEBOOK_EXT = ".ipynb";

type NotebookCell = {
	cell_type?: string;
	execution_count?: number | null;
	source?: string | string[];
	outputs?: Array<Record<string, unknown>>;
};

type Notebook = {
	cells?: NotebookCell[];
	metadata?: Record<string, unknown>;
	nbformat?: number;
	nbformat_minor?: number;
};

type DecodedPng = {
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
};

type PreviewState = {
	path?: string;
	cwd: string;
	visible: boolean;
	focused: boolean;
	scroll: number;
	lastLoadedAt?: Date;
	lastMtime?: Date;
	lastError?: string;
	model?: Notebook;
};

export default function jupyterPreview(pi: ExtensionAPI) {
	const state: PreviewState = {
		cwd: process.cwd(),
		visible: false,
		focused: false,
		scroll: 0,
	};

	let panel: NotebookPreviewPanel | undefined;
	let overlayHandle: OverlayHandle | undefined;
	let closeOverlay: (() => void) | undefined;
	let requestRender: (() => void) | undefined;

	async function setNotebookPath(rawPath: string, ctx: ExtensionContext): Promise<void> {
		const path = resolveNotebookPath(rawPath, ctx.cwd);
		state.cwd = ctx.cwd;
		state.path = path;
		state.scroll = 0;
		await loadNotebook(state);
		startWatcher(path, () => {
			void loadNotebook(state).finally(() => requestRender?.());
		});
	}

	async function showPanel(ctx: ExtensionContext, rawPath?: string): Promise<void> {
		if (!ctx.hasUI) return;
		if (rawPath?.trim()) {
			await setNotebookPath(rawPath.trim(), ctx);
		} else if (!state.path) {
			const discovered = await findFirstNotebook(ctx.cwd);
			if (!discovered) {
				ctx.ui.notify("No .ipynb file found. Use /jupyter-preview <path>.", "warning");
				return;
			}
			await setNotebookPath(discovered, ctx);
		} else {
			state.cwd = ctx.cwd;
			await loadNotebook(state);
		}

		state.visible = true;
		ctx.ui.setStatus(PANEL_ID, ctx.ui.theme.fg("accent", "ipynb preview"));

		if (overlayHandle) {
			overlayHandle.setHidden(false);
			requestRender?.();
			return;
		}

		void ctx.ui
			.custom<void>(
				(tui, theme, _keybindings, done) => {
					panel = new NotebookPreviewPanel(tui, theme, state, () => {
						state.focused = false;
						overlayHandle?.unfocus();
						tui.requestRender();
					});
					requestRender = () => tui.requestRender();
					closeOverlay = () => {
						state.visible = false;
						state.focused = false;
						done(undefined);
					};
					return panel;
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "right-center",
						width: "42%",
						minWidth: 42,
						maxHeight: "96%",
						margin: { right: 1 },
						nonCapturing: true,
						visible: (termWidth) => termWidth >= 90,
					},
					onHandle: (handle) => {
						overlayHandle = handle;
					},
				},
			)
			.finally(() => {
				overlayHandle = undefined;
				panel = undefined;
				closeOverlay = undefined;
				requestRender = undefined;
				state.visible = false;
				state.focused = false;
				ctx.ui.setStatus(PANEL_ID, undefined);
			});

		requestRender?.();
	}

	function hidePanel(ctx?: ExtensionContext): void {
		state.visible = false;
		state.focused = false;
		ctx?.ui.setStatus(PANEL_ID, undefined);
		closeOverlay?.();
		overlayHandle?.hide();
		overlayHandle = undefined;
	}

	function focusPanel(ctx: ExtensionContext): void {
		if (!overlayHandle) {
			ctx.ui.notify("Jupyter preview is not open. Use /jupyter-preview <path>.", "warning");
			return;
		}
		state.focused = true;
		overlayHandle.focus();
		requestRender?.();
		ctx.ui.notify(
			"Notebook preview focused. Use ↑/↓/PgUp/PgDn or j/k/u/d to scroll, Esc/F8 to return to editor.",
			"info",
		);
	}

	function scrollPreview(delta: number | "top", ctx?: ExtensionContext): void {
		if (!state.visible || !overlayHandle) {
			ctx?.ui.notify("Jupyter preview is not open. Use /jupyter-preview <path>.", "warning");
			return;
		}
		state.scroll = delta === "top" ? 0 : Math.max(0, state.scroll + delta);
		requestRender?.();
	}

	function parseScrollAmount(args: string, fallback: number): number {
		const value = Number.parseInt(args.trim(), 10);
		return Number.isFinite(value) && value > 0 ? value : fallback;
	}

	pi.registerCommand("jupyter-preview", {
		description: "Open or refresh a right-side .ipynb preview. Usage: /jupyter-preview [path]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			await showPanel(ctx, args);
		},
	});

	pi.registerCommand("jupyter-preview-close", {
		description: "Close the right-side Jupyter notebook preview",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			hidePanel(ctx);
		},
	});

	pi.registerCommand("jupyter-preview-toggle", {
		description: "Toggle the right-side Jupyter notebook preview. Usage: /jupyter-preview-toggle [path]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (state.visible && overlayHandle && !args.trim()) hidePanel(ctx);
			else await showPanel(ctx, args);
		},
	});

	pi.registerCommand("jupyter-preview-focus", {
		description: "Focus the notebook preview so arrow keys can scroll it; Esc returns to editor",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			focusPanel(ctx);
		},
	});

	pi.registerCommand("jupyter-preview-refresh", {
		description: "Reload the current notebook preview from disk",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!state.path) {
				ctx.ui.notify("No notebook selected. Use /jupyter-preview <path>.", "warning");
				return;
			}
			await loadNotebook(state);
			requestRender?.();
		},
	});

	pi.registerCommand("jupyter-preview-up", {
		description: "Scroll the notebook preview up. Usage: /jupyter-preview-up [lines]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			scrollPreview(-parseScrollAmount(args, 3), ctx);
		},
	});

	pi.registerCommand("jupyter-preview-down", {
		description: "Scroll the notebook preview down. Usage: /jupyter-preview-down [lines]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			scrollPreview(parseScrollAmount(args, 3), ctx);
		},
	});

	pi.registerCommand("jupyter-preview-page-up", {
		description: "Scroll the notebook preview one page up",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			scrollPreview(-12, ctx);
		},
	});

	pi.registerCommand("jupyter-preview-page-down", {
		description: "Scroll the notebook preview one page down",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			scrollPreview(12, ctx);
		},
	});

	pi.registerCommand("jupyter-preview-top", {
		description: "Scroll the notebook preview to the top",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			scrollPreview("top", ctx);
		},
	});

	pi.registerShortcut("f8", {
		description: "Toggle Jupyter notebook preview",
		handler: async (ctx) => {
			if (state.visible && overlayHandle) hidePanel(ctx);
			else await showPanel(ctx);
		},
	});

	pi.registerShortcut("shift+f8", {
		description: "Focus Jupyter notebook preview for scrolling",
		handler: async (ctx) => {
			focusPanel(ctx);
		},
	});

	pi.registerShortcut("ctrl+alt+j", {
		description: "Scroll Jupyter notebook preview down without focusing it",
		handler: async (ctx) => scrollPreview(3, ctx),
	});

	pi.registerShortcut("ctrl+alt+k", {
		description: "Scroll Jupyter notebook preview up without focusing it",
		handler: async (ctx) => scrollPreview(-3, ctx),
	});

	pi.registerShortcut("ctrl+alt+d", {
		description: "Page down Jupyter notebook preview without focusing it",
		handler: async (ctx) => scrollPreview(12, ctx),
	});

	pi.registerShortcut("ctrl+alt+u", {
		description: "Page up Jupyter notebook preview without focusing it",
		handler: async (ctx) => scrollPreview(-12, ctx),
	});

	pi.on("tool_call", async (event, ctx) => {
		const candidate = extractNotebookPath(event.input);
		if (!candidate) return;
		state.cwd = ctx.cwd;
		state.path = resolveNotebookPath(candidate, ctx.cwd);
		startWatcher(state.path, () => {
			void loadNotebook(state).finally(() => requestRender?.());
		});
	});

	pi.on("tool_result", async (event, ctx) => {
		const candidate = extractNotebookPath(event.input);
		if (!candidate) return;
		state.cwd = ctx.cwd;
		state.path = resolveNotebookPath(candidate, ctx.cwd);
		await loadNotebook(state);
		if (state.visible) requestRender?.();
		else if (ctx.hasUI) await showPanel(ctx, candidate);
	});

	pi.on("session_shutdown", async () => {
		currentWatcher?.close();
		currentWatcher = undefined;
		hidePanel();
	});
}

class NotebookPreviewPanel implements Component {
	constructor(
		private tui: TUI,
		private theme: any,
		private state: PreviewState,
		private releaseFocus: () => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, "f8")) {
			this.releaseFocus();
			return;
		}

		const page = 10;
		if (matchesKey(data, Key.up) || data === "k") this.state.scroll = Math.max(0, this.state.scroll - 1);
		else if (matchesKey(data, Key.down) || data === "j") this.state.scroll += 1;
		else if (matchesKey(data, Key.home) || data === "g") this.state.scroll = 0;
		else if (matchesKey(data, "pageup") || data === "u") this.state.scroll = Math.max(0, this.state.scroll - page);
		else if (matchesKey(data, "pagedown") || data === "d") this.state.scroll += page;
		else return;

		this.tui.requestRender();
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 2);
		const th = this.theme;
		const border = (s: string) => th.fg("border", s);
		const accent = (s: string) => th.fg("accent", s);
		const dim = (s: string) => th.fg("dim", s);
		const error = (s: string) => th.fg("error", s);
		const pad = (s = "") => {
			const truncated = truncateToWidth(s, inner, "…", true);
			return border("│") + truncated + " ".repeat(Math.max(0, inner - visibleWidth(truncated))) + border("│");
		};

		const pathLabel = this.state.path
			? relative(this.state.cwd, this.state.path) || basename(this.state.path)
			: "no notebook";
		const title = `${this.state.focused ? "● " : ""}Jupyter Preview`;
		const lines: string[] = [border(`╭${"─".repeat(inner)}╮`), pad(` ${accent(title)} ${dim(pathLabel)}`)];
		lines.push(border("├") + border("─".repeat(inner)) + border("┤"));

		if (!this.state.path) {
			lines.push(pad(" No notebook selected."));
			lines.push(pad(dim(" /jupyter-preview <file.ipynb>")));
		} else if (this.state.lastError) {
			lines.push(...wrapBoxLines(error(this.state.lastError), inner).map(pad));
		} else if (!this.state.model) {
			lines.push(pad(dim(" Loading…")));
		} else {
			const body = renderNotebookBody(this.state, inner, th);
			const scrolled = body.slice(this.state.scroll);
			lines.push(...scrolled.map(pad));
		}

		lines.push(border("├") + border("─".repeat(inner)) + border("┤"));
		const footer = this.state.focused
			? " ↑↓ PgUp/PgDn or j/k/u/d scroll • Esc/F8 return"
			: " Ctrl+Alt+j/k scroll • Ctrl+Alt+d/u page • Shift+F8 focus";
		lines.push(pad(dim(footer)));
		lines.push(border(`╰${"─".repeat(inner)}╯`));
		return lines;
	}

	invalidate(): void {}
}

function renderNotebookBody(state: PreviewState, width: number, th: any): string[] {
	const nb = state.model;
	if (!nb) return [];
	const cells = Array.isArray(nb.cells) ? nb.cells : [];
	const dim = (s: string) => th.fg("dim", s);
	const accent = (s: string) => th.fg("accent", s);
	const success = (s: string) => th.fg("success", s);
	const warning = (s: string) => th.fg("warning", s);
	const error = (s: string) => th.fg("error", s);

	const lines: string[] = [];
	const loaded = state.lastLoadedAt ? state.lastLoadedAt.toLocaleTimeString() : "unknown";
	const mtime = state.lastMtime ? state.lastMtime.toLocaleTimeString() : "unknown";
	lines.push(` ${success("✓")} ${cells.length} cells ${dim(`loaded ${loaded}, mtime ${mtime}`)}`);
	lines.push("");

	cells.forEach((cell, i) => {
		const type = cell.cell_type ?? "unknown";
		const exec = cell.execution_count == null ? "" : ` In [${cell.execution_count}]`;
		const color = type === "markdown" ? accent : type === "code" ? success : warning;
		lines.push(color(` ${i + 1}. ${type}${exec}`));

		const source = normalizeSource(cell.source).trimEnd();
		const sourceLines = source.length > 0 ? source.split("\n") : [dim("(empty)")];
		for (const line of sourceLines.slice(0, 12)) {
			lines.push(...wrapBoxLines(`   ${line}`, width));
		}
		if (sourceLines.length > 12) lines.push(dim(`   … ${sourceLines.length - 12} more source lines`));

		if (type === "code" && Array.isArray(cell.outputs) && cell.outputs.length > 0) {
			const outputLines = renderOutputs(cell.outputs, width, th);
			if (outputLines.length > 0) {
				lines.push(dim("   output:"));
				for (const outLine of outputLines.slice(0, 24)) {
					const styled = outLine.startsWith("Error:") ? error(outLine) : outLine;
					lines.push(...wrapBoxLines(`     ${styled}`, width));
				}
				if (outputLines.length > 24) lines.push(dim(`     … ${outputLines.length - 24} more output lines`));
			}
		}
		lines.push("");
	});

	return lines;
}

function renderOutputs(outputs: Array<Record<string, unknown>>, width: number, th: any): string[] {
	const lines: string[] = [];
	const dim = (s: string) => th.fg("dim", s);
	for (const output of outputs) {
		const outputType = String(output.output_type ?? "output");
		if (outputType === "stream") {
			lines.push(
				...normalizeSource(output.text as string | string[] | undefined)
					.split("\n")
					.filter(Boolean)
					.map(dim),
			);
			continue;
		}
		if (outputType === "error") {
			const ename = String(output.ename ?? "Error");
			const evalue = String(output.evalue ?? "");
			lines.push(`Error: ${ename}${evalue ? `: ${evalue}` : ""}`);
			continue;
		}
		const data = output.data as Record<string, unknown> | undefined;
		if (data) {
			const imageMime = Object.keys(data).find((key) => key.startsWith("image/"));
			if (imageMime) {
				lines.push(dim(`${imageMime}:`));
				lines.push(...renderInlineImage(normalizeSource(data[imageMime] as string | string[]), imageMime, width, th));
			}

			const text = data["text/plain"] ?? data["text/markdown"];
			if (typeof text === "string" || Array.isArray(text)) {
				lines.push(
					...normalizeSource(text as string | string[])
						.split("\n")
						.filter(Boolean)
						.map(dim),
				);
			}

			if (imageMime || typeof text === "string" || Array.isArray(text)) continue;
		}
		lines.push(dim(`[${outputType}]`));
	}
	return lines;
}

function renderInlineImage(base64Data: string, mimeType: string, width: number, th: any): string[] {
	const cleanBase64 = base64Data.replace(/\s+/g, "");
	if (!cleanBase64) return [th.fg("warning", `[empty ${mimeType} output]`)];

	// Native Kitty/iTerm image sequences are fragile inside Pi overlays because the
	// overlay compositor has to measure and splice every rendered line. Render PNGs
	// as truecolor ANSI half-block thumbnails instead; this works reliably in
	// Ghostty and keeps line widths measurable.
	if (mimeType === "image/png") {
		try {
			const png = decodePng(cleanBase64);
			return renderPngThumbnail(png, Math.max(8, Math.min(60, width - 8)), 16);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return [th.fg("warning", `[${mimeType} thumbnail failed: ${message}]`)];
		}
	}

	try {
		const image = new Image(
			cleanBase64,
			mimeType,
			{
				fallbackColor: (s: string) => th.fg("muted", s),
			},
			{
				maxWidthCells: Math.max(8, Math.min(60, width - 8)),
				maxHeightCells: 16,
			},
		);
		return image.render(Math.max(10, width - 8));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return [th.fg("warning", `[${mimeType} output: ${message}]`)];
	}
}

function decodePng(base64Data: string): DecodedPng {
	const bytes = Buffer.from(base64Data, "base64");
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature)) {
		throw new Error("not a PNG");
	}

	let offset = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	let palette: Buffer | undefined;
	let transparency: Buffer | undefined;
	const idat: Buffer[] = [];

	while (offset + 12 <= bytes.length) {
		const length = bytes.readUInt32BE(offset);
		const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
		const data = bytes.subarray(offset + 8, offset + 8 + length);
		offset += 12 + length;

		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			const compression = data[10];
			const filter = data[11];
			const interlace = data[12];
			if (compression !== 0 || filter !== 0 || interlace !== 0) throw new Error("unsupported PNG format");
		} else if (type === "PLTE") {
			palette = Buffer.from(data);
		} else if (type === "tRNS") {
			transparency = Buffer.from(data);
		} else if (type === "IDAT") {
			idat.push(Buffer.from(data));
		} else if (type === "IEND") {
			break;
		}
	}

	if (!width || !height || idat.length === 0) throw new Error("missing PNG data");
	if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);

	const channels = pngChannels(colorType);
	const bpp = Math.max(1, channels);
	const stride = width * channels;
	const inflated = inflateSync(Buffer.concat(idat));
	const raw = Buffer.alloc(height * stride);
	let inOffset = 0;
	let outOffset = 0;
	let previous = Buffer.alloc(stride);

	for (let y = 0; y < height; y++) {
		const filter = inflated[inOffset++];
		const scanline = inflated.subarray(inOffset, inOffset + stride);
		inOffset += stride;
		const recon = Buffer.alloc(stride);
		for (let x = 0; x < stride; x++) {
			const left = x >= bpp ? recon[x - bpp] : 0;
			const up = previous[x] ?? 0;
			const upLeft = x >= bpp ? previous[x - bpp] : 0;
			const value = scanline[x];
			switch (filter) {
				case 0:
					recon[x] = value;
					break;
				case 1:
					recon[x] = (value + left) & 0xff;
					break;
				case 2:
					recon[x] = (value + up) & 0xff;
					break;
				case 3:
					recon[x] = (value + Math.floor((left + up) / 2)) & 0xff;
					break;
				case 4:
					recon[x] = (value + paeth(left, up, upLeft)) & 0xff;
					break;
				default:
					throw new Error(`unsupported PNG filter ${filter}`);
			}
		}
		recon.copy(raw, outOffset);
		outOffset += stride;
		previous = recon;
	}

	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let i = 0, p = 0; i < raw.length; p++) {
		let r = 0;
		let g = 0;
		let b = 0;
		let a = 255;
		if (colorType === 0) {
			r = g = b = raw[i++];
			if (transparency?.length === 2 && r === transparency.readUInt16BE(0)) a = 0;
		} else if (colorType === 2) {
			r = raw[i++];
			g = raw[i++];
			b = raw[i++];
			if (
				transparency?.length === 6 &&
				r === transparency.readUInt16BE(0) &&
				g === transparency.readUInt16BE(2) &&
				b === transparency.readUInt16BE(4)
			)
				a = 0;
		} else if (colorType === 3) {
			const index = raw[i++];
			if (!palette || index * 3 + 2 >= palette.length) throw new Error("invalid PNG palette");
			r = palette[index * 3];
			g = palette[index * 3 + 1];
			b = palette[index * 3 + 2];
			a = transparency?.[index] ?? 255;
		} else if (colorType === 4) {
			r = g = b = raw[i++];
			a = raw[i++];
		} else if (colorType === 6) {
			r = raw[i++];
			g = raw[i++];
			b = raw[i++];
			a = raw[i++];
		}
		const o = p * 4;
		pixels[o] = r;
		pixels[o + 1] = g;
		pixels[o + 2] = b;
		pixels[o + 3] = a;
	}

	return { width, height, pixels };
}

function pngChannels(colorType: number): number {
	switch (colorType) {
		case 0:
			return 1;
		case 2:
			return 3;
		case 3:
			return 1;
		case 4:
			return 2;
		case 6:
			return 4;
		default:
			throw new Error(`unsupported PNG color type ${colorType}`);
	}
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

function renderPngThumbnail(png: DecodedPng, maxWidthCells: number, maxHeightCells: number): string[] {
	let targetWidth = Math.max(1, Math.min(maxWidthCells, png.width));
	let targetPixelHeight = Math.max(1, Math.round((png.height / png.width) * targetWidth));
	if (Math.ceil(targetPixelHeight / 2) > maxHeightCells) {
		targetPixelHeight = maxHeightCells * 2;
		targetWidth = Math.max(1, Math.min(maxWidthCells, Math.round((png.width / png.height) * targetPixelHeight)));
	}

	const rows = Math.ceil(targetPixelHeight / 2);
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = "";
		for (let x = 0; x < targetWidth; x++) {
			const upper = samplePngPixel(png, x, row * 2, targetWidth, targetPixelHeight);
			const lower =
				row * 2 + 1 < targetPixelHeight
					? samplePngPixel(png, x, row * 2 + 1, targetWidth, targetPixelHeight)
					: ([255, 255, 255] as const);
			line += `\x1b[38;2;${upper[0]};${upper[1]};${upper[2]}m\x1b[48;2;${lower[0]};${lower[1]};${lower[2]}m▀`;
		}
		lines.push(`${line}\x1b[0m`);
	}
	return lines;
}

function samplePngPixel(
	png: DecodedPng,
	x: number,
	y: number,
	targetWidth: number,
	targetHeight: number,
): readonly [number, number, number] {
	const sx = Math.min(png.width - 1, Math.max(0, Math.floor(((x + 0.5) / targetWidth) * png.width)));
	const sy = Math.min(png.height - 1, Math.max(0, Math.floor(((y + 0.5) / targetHeight) * png.height)));
	const offset = (sy * png.width + sx) * 4;
	const alpha = png.pixels[offset + 3] / 255;
	const blend = (channel: number) => Math.round(png.pixels[offset + channel] * alpha + 255 * (1 - alpha));
	return [blend(0), blend(1), blend(2)];
}

async function loadNotebook(state: PreviewState): Promise<void> {
	if (!state.path) return;
	try {
		const [raw, info] = await Promise.all([readFile(state.path, "utf8"), stat(state.path)]);
		state.model = JSON.parse(raw) as Notebook;
		state.lastMtime = info.mtime;
		state.lastLoadedAt = new Date();
		state.lastError = undefined;
	} catch (error) {
		state.model = undefined;
		state.lastLoadedAt = new Date();
		state.lastError = error instanceof Error ? error.message : String(error);
	}
}

function startWatcher(path: string, onChange: () => void): void {
	// One watcher is enough: the preview tracks one current notebook.
	// Close first so changing notebooks does not leak file descriptors.
	currentWatcher?.close();
	try {
		currentWatcher = watch(path, { persistent: false }, debounce(onChange, 150));
	} catch {
		currentWatcher = undefined;
	}
}

let currentWatcher: FSWatcher | undefined;

function debounce(fn: () => void, ms: number): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(fn, ms);
	};
}

function resolveNotebookPath(rawPath: string, cwd: string): string {
	const cleaned = rawPath.trim().replace(/^@/, "");
	return resolve(cwd, cleaned);
}

function extractNotebookPath(input: unknown): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const obj = input as Record<string, unknown>;
	for (const key of ["path", "file", "filename"] as const) {
		const value = obj[key];
		if (typeof value === "string" && value.endsWith(NOTEBOOK_EXT)) return value;
	}
	return undefined;
}

async function findFirstNotebook(cwd: string): Promise<string | undefined> {
	try {
		const entries = await readdir(cwd, { withFileTypes: true });
		const notebook = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(NOTEBOOK_EXT))
			.map((entry) => entry.name)
			.sort()[0];
		return notebook ? resolve(cwd, notebook) : undefined;
	} catch {
		return undefined;
	}
}

function normalizeSource(source: string | string[] | undefined): string {
	if (Array.isArray(source)) return source.join("");
	return typeof source === "string" ? source : "";
}

function wrapBoxLines(text: string, width: number): string[] {
	const max = Math.max(1, width - 1);
	return wrapTextWithAnsi(text, max).flatMap((line) => {
		if (visibleWidth(line) <= max) return [line];
		return [truncateToWidth(line, max, "…", true)];
	});
}
