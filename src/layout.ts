import type { ActionView, GraphData, GraphEdge, GraphNode, UID, VivSnapshot } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────────

const NODE_WIDTH = 220;
const NODE_HEIGHT = 72;
const H_GAP = 80;
const V_GAP = 40;

// Palette mapped to character IDs (cycling)
const CHAR_PALETTE = [
  "#4f9eff", "#ff6b6b", "#6bcb77", "#ffd93d",
  "#c77dff", "#ff9a3c", "#48cae4", "#f72585",
];

// ─── Build graph from snapshot ──────────────────────────────────────────────

export function buildGraph(snapshot: VivSnapshot, layoutMode: 'dag' | 'location' | 'character' = 'dag'): GraphData {
  const actions = Object.values(snapshot.entities).filter(
    (e): e is ActionView => e.entityType === "action"
  );

  // Assign stable colors per character
  const charColors = new Map<UID, string>();
  let colorIdx = 0;
  for (const action of actions) {
    if (!charColors.has(action.initiator)) {
      charColors.set(action.initiator, CHAR_PALETTE[colorIdx % CHAR_PALETTE.length]);
      colorIdx++;
    }
  }

  // Build edge list from causal relationships
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  for (const action of actions) {
    for (const caused of action.caused) {
      const key = `${action.id}→${caused}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ from: action.id, to: caused });
      }
    }
  }

  // Choose layout based on mode
  const positions = layoutMode === 'dag'
    ? computeLayeredLayout(actions, edges)
    : computeClusterLayout(snapshot, actions, edges, layoutMode);

  const nodes = new Map<UID, GraphNode>();
  for (const action of actions) {
    const pos = positions.get(action.id) ?? { col: 0, row: 0 };
    nodes.set(action.id, {
      id: action.id,
      action,
      x: pos.col * (NODE_WIDTH + H_GAP),
      y: pos.row * (NODE_HEIGHT + V_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      color: charColors.get(action.initiator) ?? CHAR_PALETTE[0],
    });
  }

  return { nodes, edges };
}

// ─── Layered layout ─────────────────────────────────────────────────────────

interface Pos { col: number; row: number }

function computeLayeredLayout(
  actions: ActionView[],
  edges: GraphEdge[]
): Map<UID, Pos> {
  const ids = actions.map((a) => a.id);

  // Time-step index per unique timestamp; used so root actions spread
  // horizontally by time even when the chronicle has no causal edges.
  const tsMap = new Map(actions.map((a) => [a.id, a.timestamp]));
  const sortedTimestamps = [...new Set(actions.map((a) => a.timestamp))].sort((a, b) => a - b);
  const timeStepIndex = new Map(sortedTimestamps.map((ts, i) => [ts, i]));

  // Build adjacency
  const children = new Map<UID, UID[]>();
  const parents = new Map<UID, UID[]>();
  for (const id of ids) { children.set(id, []); parents.set(id, []); }
  for (const e of edges) {
    children.get(e.from)?.push(e.to);
    parents.get(e.to)?.push(e.from);
  }

  // Assign layers (column = max depth from root, with roots placed at their time step)
  const layer = new Map<UID, number>();
  const visited = new Set<UID>();

  function assignLayer(id: UID): number {
    if (layer.has(id)) return layer.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);
    const pars = parents.get(id) ?? [];
    const ts = tsMap.get(id) ?? 0;
    const tsCol = timeStepIndex.get(ts) ?? 0;
    const col = pars.length === 0
      ? tsCol
      : Math.max(Math.max(...pars.map(assignLayer)) + 1, tsCol);
    layer.set(id, col);
    return col;
  }

  for (const id of ids) assignLayer(id);

  // Group by layer, sort within layer by timestamp
  const layers = new Map<number, UID[]>();
  for (const action of actions) {
    const col = layer.get(action.id) ?? 0;
    if (!layers.has(col)) layers.set(col, []);
    layers.get(col)!.push(action.id);
  }

  // Sort each layer by timestamp of the action
  for (const [, ids] of layers) {
    ids.sort((a, b) => (tsMap.get(a) ?? 0) - (tsMap.get(b) ?? 0));
  }

  // Assign positions; minimize edge crossings with a simple barycenter pass
  const positions = new Map<UID, Pos>();
  const sortedCols = [...layers.keys()].sort((a, b) => a - b);

  for (const col of sortedCols) {
    const colIds = layers.get(col)!;

    // Barycenter: reorder by average row of parents
    if (col > 0) {
      const bary = colIds.map((id) => {
        const pars = parents.get(id) ?? [];
        if (pars.length === 0) return { id, bary: Infinity };
        const rows = pars
          .map((p) => positions.get(p)?.row ?? 0)
          .reduce((sum, r) => sum + r, 0) / pars.length;
        return { id, bary: rows };
      });
      bary.sort((a, b) => {
        if (a.bary === Infinity && b.bary === Infinity) return 0;
        if (a.bary === Infinity) return 1;
        if (b.bary === Infinity) return -1;
        return a.bary - b.bary;
      });
      colIds.splice(0, colIds.length, ...bary.map((b) => b.id));
    }

    colIds.forEach((id, row) => positions.set(id, { col, row }));
  }

  return positions;
}

// ─── Cluster layout ─────────────────────────────────────────────────────────

function computeClusterLayout(
  snapshot: VivSnapshot,
  actions: ActionView[],
  edges: GraphEdge[],
  mode: 'location' | 'character'
): Map<UID, Pos> {
  // Compute unique sorted timestamps (time steps) — ordinal x-axis
  const timestamps = [...new Set(actions.map((a) => a.timestamp))].sort((a, b) => a - b);
  const timeIndex = new Map(timestamps.map((ts, i) => [ts, i]));

  const laneKey = (a: ActionView): UID =>
    mode === 'location' ? a.location : a.initiator;

  // Order lanes deterministically
  const lanes = [...new Set(actions.map(laneKey))].sort();
  const laneMap = new Map(lanes.map((id, i) => [id, i]));

  // Group actions by lane
  const laneActions = new Map<UID, ActionView[]>();
  for (const action of actions) {
    const key = laneKey(action);
    if (!laneActions.has(key)) laneActions.set(key, []);
    laneActions.get(key)!.push(action);
  }

  // Find the deepest stack across any (lane, time-step) cell so every lane
  // can be sized to fit its tallest column without bleeding into the next.
  let maxStack = 1;
  for (const [, laneActs] of laneActions) {
    const counts = new Map<number, number>();
    for (const action of laneActs) {
      const stepIdx = timeIndex.get(action.timestamp) ?? 0;
      counts.set(stepIdx, (counts.get(stepIdx) ?? 0) + 1);
    }
    for (const c of counts.values()) {
      if (c > maxStack) maxStack = c;
    }
  }
  // Lane stride: maxStack rows for nodes + 1 row of breathing room
  const laneStride = maxStack + 1;

  const positions = new Map<UID, Pos>();
  for (const [id, laneActs] of laneActions) {
    const laneIdx = laneMap.get(id) ?? 0;
    const byTime = new Map<number, ActionView[]>();
    for (const action of laneActs) {
      const stepIdx = timeIndex.get(action.timestamp) ?? 0;
      if (!byTime.has(stepIdx)) byTime.set(stepIdx, []);
      byTime.get(stepIdx)!.push(action);
    }
    for (const [stepIdx, timeActions] of byTime) {
      timeActions.forEach((action, subRow) => {
        positions.set(action.id, {
          col: stepIdx,
          row: laneIdx * laneStride + subRow,
        });
      });
    }
  }

  return positions;
}

// ─── Getters ────────────────────────────────────────────────────────────────

export function getCharacterColor(
  initiatorId: UID,
  snapshot: VivSnapshot
): string {
  const actions = Object.values(snapshot.entities).filter(
    (e): e is ActionView => e.entityType === "action"
  );
  const chars = [...new Set(actions.map((a) => a.initiator))].sort();
  const idx = chars.indexOf(initiatorId);
  return CHAR_PALETTE[idx >= 0 ? idx % CHAR_PALETTE.length : 0];
}

export { NODE_WIDTH, NODE_HEIGHT };
