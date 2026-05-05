# pi-jupyter

A Pi extension that shows a right-side, terminal-native preview for Jupyter notebooks (`.ipynb`) while you edit them with Pi.

The preview is a static text rendering of notebook cells and selected text outputs. It is not a running Jupyter kernel or browser webview.

## Features

- Right-side notebook preview overlay in Pi's TUI.
- Auto-updates when Pi reads, writes, or edits an `.ipynb` file.
- Watches the selected notebook on disk and refreshes after external saves.
- Displays markdown cells, code cells, execution counts, common text outputs/errors, and inline image outputs when the terminal supports images.
- Non-capturing by default, so you can keep typing in Pi while the panel stays visible.
- Focus mode for scrolling the preview.

## Install for this project

```bash
pi install . -l
```

Or test without installing:

```bash
pi -e .
```

## Development

```bash
npm install
just check
just format
pre-commit install
```

Publish to npm:

```bash
just publish
```

Preview the npm package without publishing:

```bash
just publish-dry-run
```

## Commands

- `/jupyter-preview [path]` — open or refresh the right-side notebook preview.
- `/jupyter-preview-toggle [path]` — toggle the preview.
- `/jupyter-preview-focus` — focus the panel so arrow keys can scroll it.
- `/jupyter-preview-refresh` — reload the current notebook from disk.
- `/jupyter-preview-close` — close the preview.

## Shortcuts

- `F8` — toggle preview.
- `Shift+F8` — focus preview for scrolling.
- `Ctrl+Alt+J` / `Ctrl+Alt+K` — scroll preview down/up without focusing it.
- `Ctrl+Alt+D` / `Ctrl+Alt+U` — page down/up without focusing it.
- In focused preview: `↑`, `↓`, `PgUp`, `PgDn`, `Home` or `j`, `k`, `u`, `d`, `g` scroll; `Esc` or `F8` returns focus to the editor.

## Notes

PNG outputs are rendered as truecolor ANSI thumbnails, so matplotlib-style `image/png` output is visible in Ghostty even inside the right-side overlay. Other image formats use `@mariozechner/pi-tui` terminal image support when available, otherwise they fall back to an image placeholder.

The panel auto-hides on narrow terminals (`< 90` columns). Resize wider if it does not appear.

If shortcuts conflict with Pi/editor keybindings, use the slash commands:

- `/jupyter-preview-down [lines]`
- `/jupyter-preview-up [lines]`
- `/jupyter-preview-page-down`
- `/jupyter-preview-page-up`
- `/jupyter-preview-top`
