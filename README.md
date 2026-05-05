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

## Install

Install from npm globally:

```bash
pi install npm:@narumitw/pi-jupyter
```

Or pin a version:

```bash
pi install npm:@narumitw/pi-jupyter@0.1.2
```

Install for the current project only:

```bash
pi install npm:@narumitw/pi-jupyter -l
```

Install from GitHub/tag instead of npm:

```bash
pi install git:github.com/narumiruna/pi-jupyter@v0.1.2
```

If you previously installed the unscoped package, remove it before installing the scoped package:

```bash
pi remove npm:pi-jupyter
pi install npm:@narumitw/pi-jupyter
```

## Local development install

Use one source at a time. If `npm:@narumitw/pi-jupyter` is installed globally and this repo is also installed locally with `-l`, Pi will load both and report shortcut conflicts.

For temporary local testing, prefer:

```bash
pi -e .
```

For a persistent project-local install:

```bash
pi install . -l
```

If you also have an npm package installed globally, remove one source before starting Pi:

```bash
# Keep the npm package; remove the project-local package from this repo
pi remove . -l

# Or keep the local package; remove the global npm package
pi remove npm:@narumitw/pi-jupyter

# If you installed the older unscoped package, remove that too
pi remove npm:pi-jupyter
```

## Development

```bash
npm install
just check
just format
pre-commit install
```

Publish to npm. This runs `biome check .` first via the `justfile`, then `npm publish --access public`:

```bash
npm login
just publish
```

If npm requires two-factor authentication, pass the one-time password:

```bash
just publish 123456
```

After publishing succeeds, this install command will work:

```bash
pi install npm:@narumitw/pi-jupyter
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
