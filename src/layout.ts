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

// ─── DAG layout ─────────────────────────────────────────────────────────────

interface Pos { col: number; row: number }

function computeLayeredLayout(
  actions: ActionView[],
  edges: GraphEdge[]
): Map<UID, Pos> {
  // col is always the action's time-step index — the x-axis is time.
  const tsMap = new Map(actions.map((a) => [a.id, a.timestamp]));
  const sortedTimestamps = [...new Set(actions.map((a) => a.timestamp))].sort((a, b) => a - b);
  const timeStepIndex = new Map(sortedTimestamps.map((ts, i) => [ts, i]));

  const childrenMap = new Map<UID, UID[]>();
  const parentsMap = new Map<UID, UID[]>();
  for (const a of actions) {
    childrenMap.set(a.id, []);
    parentsMap.set(a.id, []);
  }
  for (const e of edges) {
    childrenMap.get(e.from)?.push(e.to);
    parentsMap.get(e.to)?.push(e.from);
  }

  const col = new Map<UID, number>();
  for (const a of actions) {
    col.set(a.id, timeStepIndex.get(a.timestamp) ?? 0);
  }

  // Row assignment via DFS from each root: an action's first child
  // continues its parent's row; later siblings each take a fresh row from
  // the global counter. findFreeRow bumps a row down on collision so
  // unrelated chains don't overlap. With no causal edges, every action is
  // a root → row 0 → single horizontal lane spread by time.
  const row = new Map<UID, number>();
  const occupied = new Set<string>();
  let nextRow = 0;

  const occupy = (c: number, r: number) => { occupied.add(`${c},${r}`); };
  const isOccupied = (c: number, r: number) => occupied.has(`${c},${r}`);
  const findFreeRow = (c: number, preferredR: number): number => {
    let r = preferredR;
    while (isOccupied(c, r)) r++;
    return r;
  };

  function place(id: UID, preferredRow: number): void {
    if (row.has(id)) return;
    const c = col.get(id) ?? 0;
    const r = findFreeRow(c, preferredRow);
    if (r > nextRow) nextRow = r;
    row.set(id, r);
    occupy(c, r);

    const kids = [...(childrenMap.get(id) ?? [])].sort(
      (a, b) => (tsMap.get(a) ?? 0) - (tsMap.get(b) ?? 0)
    );
    kids.forEach((kidId, i) => {
      place(kidId, i === 0 ? r : ++nextRow);
    });
  }

  // Roots first, sorted by timestamp so earlier chains take lower rows
  const roots = actions
    .filter((a) => (parentsMap.get(a.id) ?? []).length === 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const r of roots) place(r.id, 0);

  // Anything left (e.g. cycles with no entry point)
  for (const a of actions) {
    if (!row.has(a.id)) place(a.id, 0);
  }

  const positions = new Map<UID, Pos>();
  for (const a of actions) {
    positions.set(a.id, {
      col: col.get(a.id) ?? 0,
      row: row.get(a.id) ?? 0,
    });
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
