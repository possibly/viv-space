# Viv Chronicle Visualizer

A static web app for exploring [Viv](https://github.com/possibly/viv) run snapshots — characters, locations, and the causal web of actions that connect them. Drop in a chronicle JSON and pan around the resulting graph; switch between a Sugiyama-style DAG and per-location or per-character swimlanes.

Live: <https://possibly.github.io/viv-space/>

## Loading a chronicle

Three options on the welcome screen:

1. **Upload** a local JSON file (or drag-and-drop anywhere on the page).
2. **Load sample world** — a small bundled chronicle for poking around.
3. **Paste a URL** to a chronicle JSON file. GitHub `blob` URLs are auto-rewritten to `raw.githubusercontent.com`, so you can paste links straight from the GitHub UI.

### `?url=` query param

Append `?url=<chronicle-json-url>` to the page URL to auto-load on visit, e.g.

```
https://possibly.github.io/viv-space/?url=https://github.com/<you>/<repo>/blob/main/chronicle.json
```

After a successful URL-input load, the address bar updates with the same query param so the link is shareable as-is.

## Sharing your own chronicles via GitHub

Authors can export Viv snapshots and host them on GitHub for free:

1. Export the snapshot from your Viv run as JSON.
2. Commit the file to any public GitHub repo (e.g. a `viv-dump` repo with one JSON per scene/seed).
3. Copy the GitHub blob URL (`https://github.com/<you>/<repo>/blob/<branch>/<path>.json`).
4. Share `https://possibly.github.io/viv-space/?url=<that-url>` — the visualizer fetches it directly. No backend required.

## Development

```sh
npm install
npm run dev        # local server on http://localhost:3000
npm run build      # → dist/
npm run typecheck
```

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`.
