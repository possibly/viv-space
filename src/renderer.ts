import type { AppState, GraphEdge, GraphNode, UID, VivSnapshot } from "./types";
import { NODE_WIDTH, NODE_HEIGHT } from "./layout";

// ─── Constants ──────────────────────────────────────────────────────────────

const BG_COLOR = "#0f1117";
const GRID_COLOR = "#1a1d27";
const NODE_BG = "#1e2130";
const NODE_BORDER = "#2a2f45";
const NODE_SELECTED_BORDER = "#4f9eff";
const NODE_HOVERED_BORDER = "#6bcb77";
const EDGE_COLOR = "#2a3a5a";
const EDGE_SELECTED_COLOR = "#4f9eff";
const TEXT_PRIMARY = "#e8ecf5";
const TEXT_SECONDARY = "#7a8299";
const TEXT_TAG = "#4f9eff";
const IMPORTANCE_HIGH = "#ff6b6b";
const IMPORTANCE_MED = "#ffd93d";
const IMPORTANCE_LOW = "#6bcb77";

// Tag badge colors
const TAG_COLORS: Record<string, string> = {
  conflict: "#ff6b6b",
  plan: "#c77dff",
  trade: "#6bcb77",
  social: "#4f9eff",
  deception: "#ff9a3c",
  reaction: "#ffd93d",
  rumor: "#ff9a3c",
  "key-event": "#f72585",
  revenge: "#ff6b6b",
  alliance: "#6bcb77",
  threat: "#ff6b6b",
  greeting: "#4f9eff",
  scheme: "#c77dff",
  agreement: "#6bcb77",
};

// ─── Main render ─────────────────────────────────────────────────────────────

export function render(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  width: number,
  height: number
): void {
  const { viewport, graph, selectedNodeId, hoveredNodeId, snapshot } = state;
  if (!graph || !snapshot) return;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  // Draw grid
  drawGrid(ctx, viewport, width, height);

  ctx.save();
  ctx.translate(viewport.x, viewport.y);
  ctx.scale(viewport.scale, viewport.scale);

  // Determine highlighted set
  const highlightedIds = getHighlightedIds(selectedNodeId, graph.edges, graph.nodes);

  // Viewport bounds in world space (for culling)
  const worldLeft = -viewport.x / viewport.scale;
  const worldTop = -viewport.y / viewport.scale;
  const worldRight = worldLeft + width / viewport.scale;
  const worldBottom = worldTop + height / viewport.scale;
  // Add generous margin so edges to off-screen nodes still draw
  const margin = 300;

  function isNodeVisible(node: GraphNode): boolean {
    return (
      node.x + node.width + margin > worldLeft &&
      node.x - margin < worldRight &&
      node.y + node.height + margin > worldTop &&
      node.y - margin < worldBottom
    );
  }

  // At very low scale, draw simplified dots instead of full nodes
  const simplified = viewport.scale < 0.25;

  // Draw cluster mode UI (lane backgrounds, time axis)
  if (state.layoutMode !== 'dag') {
    drawClusterModeUI(ctx, state, graph, width / viewport.scale, height / viewport.scale);
  }

  // Draw edges first (only those with at least one visible endpoint)
  for (const edge of graph.edges) {
    const fromNode = graph.nodes.get(edge.from);
    const toNode = graph.nodes.get(edge.to);
    if (!fromNode || !toNode) continue;
    if (!isNodeVisible(fromNode) && !isNodeVisible(toNode)) continue;
    const isHighlighted =
      selectedNodeId !== null &&
      (edge.from === selectedNodeId || edge.to === selectedNodeId);
    drawEdge(ctx, fromNode, toNode, isHighlighted, selectedNodeId !== null);
  }

  // Draw plan queue edges (dashed, lighter)
  if (state.showQueues && snapshot.vivInternalState) {
    drawQueueEdges(ctx, snapshot, graph.nodes);
  }

  // Draw nodes
  for (const [, node] of graph.nodes) {
    if (!isNodeVisible(node)) continue;
    const isSelected = node.id === selectedNodeId;
    const isHovered = node.id === hoveredNodeId;
    const isFaded = selectedNodeId !== null && !highlightedIds.has(node.id);
    if (simplified && !isSelected && !isHovered) {
      drawSimplifiedNode(ctx, node, isFaded);
    } else {
      drawNode(ctx, node, snapshot, isSelected, isHovered, isFaded, viewport.scale);
    }
  }

  ctx.restore();
}

// ─── Grid ────────────────────────────────────────────────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  vp: { x: number; y: number; scale: number },
  w: number,
  h: number
): void {
  const gridSize = 40 * vp.scale;
  const offsetX = vp.x % gridSize;
  const offsetY = vp.y % gridSize;

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;

  for (let x = offsetX; x < w; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = offsetY; y < h; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ─── Cluster mode UI ──────────────────────────────────────────────────────────

function drawClusterModeUI(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  graph: { nodes: Map<UID, GraphNode>; edges: GraphEdge[] },
  worldWidth: number,
  worldHeight: number
): void {
  if (!state.snapshot) return;

  // Compute lane information from nodes: map lane row to (location/char, color)
  const laneInfo = new Map<number, { label: string; color: string }>();
  const nodesByLane = new Map<number, GraphNode[]>();

  for (const node of graph.nodes.values()) {
    const laneIdx = Math.floor(node.y / (NODE_HEIGHT + 40));
    if (!nodesByLane.has(laneIdx)) {
      nodesByLane.set(laneIdx, []);
    }
    nodesByLane.get(laneIdx)!.push(node);
  }

  // Build lane labels based on mode
  if (state.layoutMode === 'location') {
    for (const [laneIdx, nodes] of nodesByLane) {
      if (nodes.length > 0) {
        const locId = nodes[0].action.location;
        const locEntity = state.snapshot.entities[locId];
        const label = locEntity?.name ?? locId.substring(0, 8);
        laneInfo.set(laneIdx, { label, color: nodes[0].color });
      }
    }
  } else if (state.layoutMode === 'character') {
    for (const [laneIdx, nodes] of nodesByLane) {
      if (nodes.length > 0) {
        const charId = nodes[0].action.initiator;
        const charEntity = state.snapshot.entities[charId];
        const label = charEntity?.name ?? charId.substring(0, 8);
        laneInfo.set(laneIdx, { label, color: nodes[0].color });
      }
    }
  } else if (state.layoutMode === 'both') {
    for (const [laneIdx, nodes] of nodesByLane) {
      if (nodes.length > 0) {
        const locId = nodes[0].action.location;
        const charId = nodes[0].action.initiator;
        const locEntity = state.snapshot.entities[locId];
        const charEntity = state.snapshot.entities[charId];
        const locName = locEntity?.name ?? locId.substring(0, 4);
        const charName = charEntity?.name ?? charId.substring(0, 4);
        const label = `${charName} @ ${locName}`;
        laneInfo.set(laneIdx, { label, color: nodes[0].color });
      }
    }
  }

  // Determine lane boundaries
  const lanes = [...nodesByLane.keys()].sort((a, b) => a - b);
  const laneHeight = NODE_HEIGHT + 40;

  // Draw horizontal lane separators (light lines between lanes)
  ctx.strokeStyle = NODE_BORDER;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.3;
  for (let i = 1; i < lanes.length; i++) {
    const y = lanes[i] * laneHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(worldWidth, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Draw alternating lane backgrounds
  for (let i = 0; i < lanes.length; i++) {
    const laneIdx = lanes[i];
    const y = laneIdx * laneHeight;
    const nextY = i + 1 < lanes.length ? lanes[i + 1] * laneHeight : worldHeight;

    if (i % 2 === 0) {
      ctx.fillStyle = "#1a1d27";
      ctx.globalAlpha = 0.3;
      ctx.fillRect(0, y, worldWidth, nextY - y);
    }
  }
  ctx.globalAlpha = 1;

  // Draw lane labels on the left side
  ctx.font = "12px Inter, Segoe UI, system-ui, sans-serif";
  ctx.fillStyle = TEXT_SECONDARY;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (const [laneIdx, info] of laneInfo) {
    const y = laneIdx * laneHeight + laneHeight / 2;
    ctx.fillText(info.label, -8, y);
  }
}

// ─── Edges ───────────────────────────────────────────────────────────────────

function drawEdge(
  ctx: CanvasRenderingContext2D,
  from: GraphNode,
  to: GraphNode,
  isHighlighted: boolean,
  dimOthers: boolean
): void {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;

  const cp1x = x1 + (x2 - x1) * 0.5;
  const cp2x = x1 + (x2 - x1) * 0.5;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(cp1x, y1, cp2x, y2, x2, y2);

  if (isHighlighted) {
    ctx.strokeStyle = EDGE_SELECTED_COLOR;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = EDGE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = dimOthers ? 0.15 : 0.7;
  }

  ctx.stroke();
  ctx.globalAlpha = 1;

  // Arrow head
  const angle = Math.atan2(y2 - (y2 + y1) / 2, x2 - cp2x);
  drawArrow(ctx, x2, y2, angle, isHighlighted);
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  highlighted: boolean
): void {
  const len = 9;
  const spread = 0.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - len * Math.cos(angle - spread), y - len * Math.sin(angle - spread));
  ctx.lineTo(x - len * Math.cos(angle + spread), y - len * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fillStyle = highlighted ? EDGE_SELECTED_COLOR : EDGE_COLOR;
  ctx.globalAlpha = highlighted ? 1 : 0.7;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawQueueEdges(
  ctx: CanvasRenderingContext2D,
  snapshot: VivSnapshot,
  nodes: Map<UID, GraphNode>
): void {
  ctx.setLineDash([5, 6]);
  ctx.strokeStyle = "#c77dff";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.4;

  const { actionQueues } = snapshot.vivInternalState;
  for (const [, queue] of Object.entries(actionQueues)) {
    for (const item of queue) {
      for (const causeId of (item as { causes?: UID[] }).causes ?? []) {
        const causeNode = nodes.get(causeId);
        if (!causeNode) continue;
        // Draw a dangling arrow to indicate queued continuation
        const x1 = causeNode.x + causeNode.width / 2;
        const y1 = causeNode.y + causeNode.height;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1, y1 + 40);
        ctx.stroke();
        // Label
        ctx.fillStyle = "#c77dff";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`⏳ ${(item as { constructName?: string }).constructName ?? "?"}`, x1, y1 + 55);
        ctx.textAlign = "left";
      }
    }
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// ─── Node ────────────────────────────────────────────────────────────────────

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  snapshot: VivSnapshot,
  isSelected: boolean,
  isHovered: boolean,
  isFaded: boolean,
  scale: number
): void {
  const { x, y, width, height, action } = node;

  ctx.globalAlpha = isFaded ? 0.25 : 1;

  // Shadow
  if (isSelected || isHovered) {
    ctx.shadowColor = isSelected ? NODE_SELECTED_BORDER : NODE_HOVERED_BORDER;
    ctx.shadowBlur = 20;
  }

  // Background
  ctx.fillStyle = NODE_BG;
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();

  // Left color accent bar
  ctx.fillStyle = node.color;
  roundRectLeft(ctx, x, y, 5, height, 8);
  ctx.fill();

  // Border
  ctx.strokeStyle = isSelected
    ? NODE_SELECTED_BORDER
    : isHovered
    ? NODE_HOVERED_BORDER
    : NODE_BORDER;
  ctx.lineWidth = isSelected ? 2 : 1.5;
  roundRect(ctx, x, y, width, height, 8);
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Importance dot
  const impColor =
    action.importance >= 0.9
      ? IMPORTANCE_HIGH
      : action.importance >= 0.7
      ? IMPORTANCE_MED
      : IMPORTANCE_LOW;
  ctx.fillStyle = impColor;
  ctx.beginPath();
  ctx.arc(x + width - 14, y + 14, 5, 0, Math.PI * 2);
  ctx.fill();

  // Action name
  ctx.fillStyle = TEXT_PRIMARY;
  ctx.font = `bold 12px "Inter", "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(truncate(action.name, 22), x + 14, y + 20);

  // Gloss line
  if (action.gloss) {
    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = `11px "Inter", "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(truncate(action.gloss, 30), x + 14, y + 36);
  }

  // Initiator name
  const initiatorName = getEntityName(action.initiator, snapshot);
  ctx.fillStyle = node.color;
  ctx.font = `10px "Inter", "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(`@${initiatorName}`, x + 14, y + 52);

  // Tags (first two)
  const tagsToShow = action.tags.slice(0, 2);
  let tagX = x + 14 + ctx.measureText(`@${initiatorName}`).width + 8;
  for (const tag of tagsToShow) {
    const tagColor = TAG_COLORS[tag] ?? TEXT_TAG;
    ctx.fillStyle = tagColor + "33";
    const tagW = ctx.measureText(tag).width + 8;
    roundRect(ctx, tagX, y + 42, tagW, 14, 4);
    ctx.fill();
    ctx.fillStyle = tagColor;
    ctx.fillText(tag, tagX + 4, y + 52);
    tagX += tagW + 4;
  }

  // Timestamp
  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = `9px monospace`;
  ctx.textAlign = "right";
  ctx.fillText(`T=${action.timestamp}`, x + width - 22, y + height - 8);
  ctx.textAlign = "left";

  ctx.globalAlpha = 1;
}

// ─── Simplified (low-zoom) node ──────────────────────────────────────────────

function drawSimplifiedNode(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  isFaded: boolean
): void {
  ctx.globalAlpha = isFaded ? 0.2 : 0.8;
  ctx.fillStyle = node.color;
  roundRect(ctx, node.x, node.y, node.width, node.height, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getHighlightedIds(
  selectedId: UID | null,
  edges: GraphEdge[],
  nodes: Map<UID, GraphNode>
): Set<UID> {
  if (!selectedId) return new Set();
  const set = new Set<UID>([selectedId]);
  for (const e of edges) {
    if (e.from === selectedId) set.add(e.to);
    if (e.to === selectedId) set.add(e.from);
  }
  return set;
}

export function getEntityName(id: UID, snapshot: VivSnapshot): string {
  const e = snapshot.entities[id];
  if (!e) return id;
  return (e.name as string) ?? id;
}

function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + "…";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundRectLeft(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── Hit testing ─────────────────────────────────────────────────────────────

export function hitTest(
  canvasX: number,
  canvasY: number,
  viewport: { x: number; y: number; scale: number },
  nodes: Map<UID, GraphNode>
): UID | null {
  const wx = (canvasX - viewport.x) / viewport.scale;
  const wy = (canvasY - viewport.y) / viewport.scale;

  for (const [id, node] of nodes) {
    if (
      wx >= node.x &&
      wx <= node.x + node.width &&
      wy >= node.y &&
      wy <= node.y + node.height
    ) {
      return id;
    }
  }
  return null;
}

// ─── Minimap ─────────────────────────────────────────────────────────────────

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  mmW: number,
  mmH: number,
  canvasW: number,
  canvasH: number
): void {
  if (!state.graph) return;
  const nodes = [...state.graph.nodes.values()];
  if (nodes.length === 0) return;

  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  const gw = maxX - minX || 1;
  const gh = maxY - minY || 1;

  const scale = Math.min(mmW / gw, mmH / gh) * 0.9;
  const ox = (mmW - gw * scale) / 2 - minX * scale;
  const oy = (mmH - gh * scale) / 2 - minY * scale;

  // Background
  ctx.fillStyle = "#0f111780";
  ctx.fillRect(0, 0, mmW, mmH);
  ctx.strokeStyle = "#2a2f45";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, mmW, mmH);

  // Nodes as tiny rects
  for (const node of nodes) {
    ctx.fillStyle = node.color + "99";
    ctx.fillRect(
      node.x * scale + ox,
      node.y * scale + oy,
      Math.max(node.width * scale, 3),
      Math.max(node.height * scale, 2)
    );
  }

  // Viewport rectangle
  const vx = (-state.viewport.x / state.viewport.scale) * scale + ox;
  const vy = (-state.viewport.y / state.viewport.scale) * scale + oy;
  const vw = (canvasW / state.viewport.scale) * scale;
  const vh = (canvasH / state.viewport.scale) * scale;

  ctx.strokeStyle = "#4f9eff88";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vx, vy, vw, vh);
}
