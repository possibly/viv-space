import type { AppState, VivSnapshot, UID } from "./types";
import { buildGraph, NODE_WIDTH, NODE_HEIGHT } from "./layout";
import { render, hitTest, renderMinimap } from "./renderer";
import { createDrawer, updateDrawer } from "./drawer";
import { buildSidebar } from "./filters";

// ─── App state ────────────────────────────────────────────────────────────────

const state: AppState = {
  snapshot: null,
  graph: null,
  viewport: { x: 60, y: 60, scale: 1 },
  selectedNodeId: null,
  hoveredNodeId: null,
  isDragging: false,
  dragStart: null,
  filterCharacter: null,
  filterTag: null,
  showPlans: true,
  showQueues: true,
  layoutMode: 'dag',
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const canvas = document.getElementById("main-canvas") as HTMLCanvasElement;
const miniCanvas = document.getElementById("mini-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const miniCtx = miniCanvas.getContext("2d")!;
const sidebar = document.getElementById("sidebar-content")!;
const drawer = document.getElementById("action-drawer") as HTMLElement;
const uploadInput = document.getElementById("upload-input") as HTMLInputElement;
const uploadZone = document.getElementById("upload-zone")!;
const welcomeOverlay = document.getElementById("welcome-overlay")!;
const loadSampleBtn = document.getElementById("load-sample-btn")!;
const statsBar = document.getElementById("stats-bar")!;
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const zoomInBtn = document.getElementById("zoom-in")!;
const zoomOutBtn = document.getElementById("zoom-out")!;
const zoomResetBtn = document.getElementById("zoom-reset")!;
const zoomFitBtn = document.getElementById("zoom-fit")!;

// ─── Resize ───────────────────────────────────────────────────────────────────

function resizeCanvas(): void {
  canvas.width = canvas.offsetWidth * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  requestAnimationFrame(frame);
}

const ro = new ResizeObserver(resizeCanvas);
ro.observe(canvas);

// ─── RAF loop ─────────────────────────────────────────────────────────────────

let rafId = 0;
function frame(): void {
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  render(ctx, state, w, h);
  renderMinimap(miniCtx, state, miniCanvas.width, miniCanvas.height, w, h);
}

function scheduleFrame(): void {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(frame);
}

// ─── Load snapshot ────────────────────────────────────────────────────────────

function loadSnapshot(snapshot: VivSnapshot): void {
  state.snapshot = snapshot;
  state.graph = buildGraph(snapshot);
  state.selectedNodeId = null;
  state.filterCharacter = null;
  state.filterTag = null;

  // Auto-fit
  fitView();

  // Rebuild sidebar
  buildSidebar(sidebar, snapshot, state, () => {
    scheduleFrame();
    updateDrawer(drawer, state);
  });

  // Update stats bar
  const actions = Object.values(snapshot.entities).filter(
    (e) => e.entityType === "action"
  );
  const chars = Object.values(snapshot.entities).filter(
    (e) => e.entityType === "character"
  );
  statsBar.innerHTML = `
    <span>${actions.length} actions</span>
    <span>${chars.length} characters</span>
    <span>T=${snapshot.timestamp}</span>
    <span>schema ${snapshot.schemaVersion}</span>
  `;

  welcomeOverlay.style.display = "none";
  scheduleFrame();
}

// ─── Fit view ─────────────────────────────────────────────────────────────────

function fitView(): void {
  if (!state.graph) return;
  const nodes = [...state.graph.nodes.values()];
  if (nodes.length === 0) return;

  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  const gw = maxX - minX;
  const gh = maxY - minY;

  const cw = canvas.offsetWidth;
  const ch = canvas.offsetHeight;
  const pad = 80;

  const scaleX = (cw - pad * 2) / gw;
  const scaleY = (ch - pad * 2) / gh;
  const scale = Math.min(scaleX, scaleY, 1.2);

  state.viewport = {
    x: pad - minX * scale,
    y: pad - minY * scale,
    scale,
  };
  scheduleFrame();
}

// ─── Mouse / touch interaction ────────────────────────────────────────────────

function canvasCoords(e: MouseEvent | Touch): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const { x, y } = canvasCoords(e);
  const hit = state.graph ? hitTest(x, y, state.viewport, state.graph.nodes) : null;

  if (hit) {
    if (state.selectedNodeId === hit) {
      // deselect
      state.selectedNodeId = null;
    } else {
      state.selectedNodeId = hit;
    }
    updateDrawer(drawer, state);
    scheduleFrame();
    return;
  }

  // Start pan
  state.isDragging = true;
  state.dragStart = { x, y, vx: state.viewport.x, vy: state.viewport.y };
  canvas.style.cursor = "grabbing";
});

canvas.addEventListener("mousemove", (e) => {
  const { x, y } = canvasCoords(e);

  if (state.isDragging && state.dragStart) {
    state.viewport.x = state.dragStart.vx + (x - state.dragStart.x);
    state.viewport.y = state.dragStart.vy + (y - state.dragStart.y);
    scheduleFrame();
    return;
  }

  if (state.graph) {
    const hit = hitTest(x, y, state.viewport, state.graph.nodes);
    if (hit !== state.hoveredNodeId) {
      state.hoveredNodeId = hit;
      canvas.style.cursor = hit ? "pointer" : "grab";
      scheduleFrame();
    }
  }
});

canvas.addEventListener("mouseup", () => {
  state.isDragging = false;
  state.dragStart = null;
  canvas.style.cursor = state.hoveredNodeId ? "pointer" : "grab";
});

canvas.addEventListener("mouseleave", () => {
  state.isDragging = false;
  state.dragStart = null;
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const { x, y } = canvasCoords(e);
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const newScale = Math.max(0.1, Math.min(4, state.viewport.scale * factor));

  // Zoom toward cursor
  state.viewport.x = x - (x - state.viewport.x) * (newScale / state.viewport.scale);
  state.viewport.y = y - (y - state.viewport.y) * (newScale / state.viewport.scale);
  state.viewport.scale = newScale;
  scheduleFrame();
}, { passive: false });

// ─── Touch support ────────────────────────────────────────────────────────────

let lastTouchDist = 0;
let lastTouch: Touch | null = null;

canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    lastTouch = e.touches[0];
    const { x, y } = canvasCoords(e.touches[0]);
    state.dragStart = { x, y, vx: state.viewport.x, vy: state.viewport.y };
  } else if (e.touches.length === 2) {
    lastTouchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (e.touches.length === 1 && state.dragStart) {
    const { x, y } = canvasCoords(e.touches[0]);
    state.viewport.x = state.dragStart.vx + (x - state.dragStart.x);
    state.viewport.y = state.dragStart.vy + (y - state.dragStart.y);
    scheduleFrame();
  } else if (e.touches.length === 2) {
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const factor = dist / (lastTouchDist || dist);
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - canvas.getBoundingClientRect().left;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - canvas.getBoundingClientRect().top;
    const newScale = Math.max(0.1, Math.min(4, state.viewport.scale * factor));
    state.viewport.x = midX - (midX - state.viewport.x) * (newScale / state.viewport.scale);
    state.viewport.y = midY - (midY - state.viewport.y) * (newScale / state.viewport.scale);
    state.viewport.scale = newScale;
    lastTouchDist = dist;
    scheduleFrame();
  }
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
  if (e.touches.length === 0 && e.changedTouches.length === 1 && lastTouch) {
    // Tap = click
    const touch = e.changedTouches[0];
    const { x, y } = canvasCoords(touch);
    const dx = Math.abs(x - (state.dragStart?.x ?? x));
    const dy = Math.abs(y - (state.dragStart?.y ?? y));
    if (dx < 8 && dy < 8 && state.graph) {
      const hit = hitTest(x, y, state.viewport, state.graph.nodes);
      state.selectedNodeId = hit === state.selectedNodeId ? null : hit;
      updateDrawer(drawer, state);
      scheduleFrame();
    }
  }
  state.dragStart = null;
  lastTouch = null;
});

// ─── Drawer action-link clicks ────────────────────────────────────────────────

drawer.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".action-link") as HTMLElement | null;
  if (btn?.dataset["id"]) {
    state.selectedNodeId = btn.dataset["id"] as UID;
    updateDrawer(drawer, state);
    scrollToNode(btn.dataset["id"]);
    scheduleFrame();
  }
});

function scrollToNode(id: UID): void {
  if (!state.graph) return;
  const node = state.graph.nodes.get(id);
  if (!node) return;
  const cw = canvas.offsetWidth;
  const ch = canvas.offsetHeight;
  state.viewport.x = cw / 2 - (node.x + node.width / 2) * state.viewport.scale;
  state.viewport.y = ch / 2 - (node.y + node.height / 2) * state.viewport.scale;
  scheduleFrame();
}

// ─── Layout mode toggle ──────────────────────────────────────────────────

const layoutModeSelect = document.getElementById("layout-mode-select") as HTMLSelectElement;
layoutModeSelect.addEventListener("change", () => {
  const newMode = layoutModeSelect.value as 'dag' | 'location' | 'character';
  if (newMode === state.layoutMode) return;

  state.layoutMode = newMode;

  if (state.snapshot) {
    state.graph = buildGraph(state.snapshot, state.layoutMode);
    fitView();
  }

  scheduleFrame();
});

// ─── Zoom controls ────────────────────────────────────────────────────────────

zoomInBtn.addEventListener("click", () => {
  const cx = canvas.offsetWidth / 2, cy = canvas.offsetHeight / 2;
  const ns = Math.min(4, state.viewport.scale * 1.2);
  state.viewport.x = cx - (cx - state.viewport.x) * (ns / state.viewport.scale);
  state.viewport.y = cy - (cy - state.viewport.y) * (ns / state.viewport.scale);
  state.viewport.scale = ns;
  scheduleFrame();
});

zoomOutBtn.addEventListener("click", () => {
  const cx = canvas.offsetWidth / 2, cy = canvas.offsetHeight / 2;
  const ns = Math.max(0.1, state.viewport.scale / 1.2);
  state.viewport.x = cx - (cx - state.viewport.x) * (ns / state.viewport.scale);
  state.viewport.y = cy - (cy - state.viewport.y) * (ns / state.viewport.scale);
  state.viewport.scale = ns;
  scheduleFrame();
});

zoomResetBtn.addEventListener("click", () => {
  state.viewport = { x: 60, y: 60, scale: 1 };
  scheduleFrame();
});

zoomFitBtn.addEventListener("click", fitView);

// ─── Search ───────────────────────────────────────────────────────────────────

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q || !state.graph || !state.snapshot) {
    state.selectedNodeId = null;
    updateDrawer(drawer, state);
    scheduleFrame();
    return;
  }

  for (const [id, node] of state.graph.nodes) {
    const a = node.action;
    const haystack = [
      a.name,
      a.gloss ?? "",
      a.report ?? "",
      ...a.tags,
      a.initiator,
    ].join(" ").toLowerCase();
    if (haystack.includes(q)) {
      state.selectedNodeId = id;
      scrollToNode(id);
      updateDrawer(drawer, state);
      scheduleFrame();
      return;
    }
  }
});

// ─── File upload ──────────────────────────────────────────────────────────────

function parseAndLoad(text: string, filename?: string): void {
  try {
    const raw = JSON.parse(text);
    validateSnapshot(raw);
    loadSnapshot(raw as VivSnapshot);
  } catch (err) {
    showError(`Could not parse chronicle${filename ? ` (${filename})` : ""}: ${(err as Error).message}`);
  }
}

function attachFileInput(el: HTMLInputElement): void {
  el.addEventListener("change", () => {
    const file = el.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => parseAndLoad(reader.result as string, file.name);
    reader.readAsText(file);
    el.value = "";
  });
}

attachFileInput(uploadInput);

// The overlay also has an upload button - wire it up
const overlayInput = document.getElementById("upload-input-overlay") as HTMLInputElement | null;
if (overlayInput) attachFileInput(overlayInput);

// Drag-and-drop on the welcome overlay
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => parseAndLoad(reader.result as string, file.name);
  reader.readAsText(file);
});

// Also allow drop anywhere on the body after loading
document.body.addEventListener("dragover", (e) => e.preventDefault());
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => parseAndLoad(reader.result as string, file.name);
  reader.readAsText(file);
});

// ─── Load sample ──────────────────────────────────────────────────────────────

loadSampleBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("./sample-chronicle.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    validateSnapshot(raw);
    loadSnapshot(raw as VivSnapshot);
  } catch (err) {
    showError(`Failed to load sample: ${(err as Error).message}`);
  }
});

// ─── Load from URL ────────────────────────────────────────────────────────────

function normalizeChronicleUrl(input: string): string {
  const url = input.trim();
  // GitHub blob: https://github.com/{owner}/{repo}/blob/{branch}/{path}
  //   →  https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
  const blobMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (blobMatch) {
    return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
  }
  // GitHub /raw/ shortcut also redirects, but raw.githubusercontent.com is the canonical CORS-enabled source
  return url;
}

const urlInput = document.getElementById("url-input") as HTMLInputElement | null;
const loadUrlBtn = document.getElementById("load-url-btn") as HTMLButtonElement | null;

async function loadFromUrl(rawUrl: string): Promise<void> {
  const url = normalizeChronicleUrl(rawUrl);
  if (!url) {
    showError("Please enter a URL.");
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    showError("Not a valid URL.");
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    showError("URL must use http or https.");
    return;
  }

  if (loadUrlBtn) {
    loadUrlBtn.disabled = true;
    loadUrlBtn.textContent = "Loading…";
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    parseAndLoad(text, parsed.pathname.split("/").pop() ?? "remote");
  } catch (err) {
    showError(`Failed to load URL: ${(err as Error).message}`);
  } finally {
    if (loadUrlBtn) {
      loadUrlBtn.disabled = false;
      loadUrlBtn.textContent = "Load URL";
    }
  }
}

if (urlInput && loadUrlBtn) {
  loadUrlBtn.addEventListener("click", () => loadFromUrl(urlInput.value));
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadFromUrl(urlInput.value);
    }
  });
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    state.selectedNodeId = null;
    updateDrawer(drawer, state);
    scheduleFrame();
  }
  if (e.key === "f" || e.key === "F") fitView();
  if ((e.key === "=" || e.key === "+") && !e.ctrlKey && !e.metaKey) {
    zoomInBtn.click();
  }
  if (e.key === "-" && !e.ctrlKey && !e.metaKey) zoomOutBtn.click();
});

// ─── Validation ───────────────────────────────────────────────────────────────

function validateSnapshot(raw: unknown): void {
  if (typeof raw !== "object" || raw === null) throw new Error("Must be a JSON object");
  const obj = raw as Record<string, unknown>;
  for (const key of ["timestamp", "entities", "vivInternalState"]) {
    if (!(key in obj)) throw new Error(`Missing required field: "${key}"`);
  }
}

// ─── Error toast ─────────────────────────────────────────────────────────────

function showError(msg: string): void {
  const toast = document.createElement("div");
  toast.className = "error-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

resizeCanvas();
