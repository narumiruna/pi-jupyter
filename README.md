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

## Commands

- `/jupyter-preview [path]` — open or refresh the right-side notebook preview.
- `/jupyter-preview-toggle [path]` — toggle the preview.
- `/jupyter-preview-focus` — focus the panel so arrow keys can scroll it.
- `/jupyter-preview-refresh` — reload the current notebook from disk.
- `/jupyter-preview-close` — close the preview.

## Shortcuts

- `F8` — toggle preview.
- `Shift+F8` — focus preview for scrolling.
- `Ctrl+↓` / `Ctrl+↑` — scroll preview down/up without focusing it.
- `Ctrl+Shift+↓` / `Ctrl+Shift+↑` — page down/up without focusing it.
- In focused preview: `↑`, `↓`, `PgUp`, `PgDn`, `Home` or `j`, `k`, `u`, `d`, `g` scroll; `Esc` or `F8` returns focus to the editor.

## Notes

Inline images require a terminal/image protocol supported by `@mariozechner/pi-tui` (for example Kitty, iTerm2, Ghostty, or WezTerm). In unsupported terminals the preview falls back to an image placeholder.

The panel auto-hides on narrow terminals (`< 90` columns). Resize wider if it does not appear.

If arrow keys conflict with Pi/editor keybindings, use the non-focusing `Ctrl+↑`/`Ctrl+↓` shortcuts or the slash commands:

- `/jupyter-preview-down [lines]`
- `/jupyter-preview-up [lines]`
- `/jupyter-preview-page-down`
- `/jupyter-preview-page-up`
- `/jupyter-preview-top`
