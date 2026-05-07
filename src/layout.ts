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

export function buildGraph(snapshot: VivSnapshot, layoutMode: 'dag' | 'location' | 'character' | 'both' = 'dag'): GraphData {
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

  // Build adjacency
  const children = new Map<UID, UID[]>();
  const parents = new Map<UID, UID[]>();
  for (const id of ids) { children.set(id, []); parents.set(id, []); }
  for (const e of edges) {
    children.get(e.from)?.push(e.to);
    parents.get(e.to)?.push(e.from);
  }

  // Assign layers (column = max depth from root)
  const layer = new Map<UID, number>();
  const visited = new Set<UID>();

  function assignLayer(id: UID): number {
    if (layer.has(id)) return layer.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);
    const pars = parents.get(id) ?? [];
    const col = pars.length === 0 ? 0 : Math.max(...pars.map(assignLayer)) + 1;
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
  const tsMap = new Map(actions.map((a) => [a.id, a.timestamp]));
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

const LANE_HEIGHT = 140;
const COL_WIDTH = NODE_WIDTH + H_GAP;
const SUB_ROW_HEIGHT = NODE_HEIGHT + 20;

function computeClusterLayout(
  snapshot: VivSnapshot,
  actions: ActionView[],
  edges: GraphEdge[],
  mode: 'location' | 'character' | 'both'
): Map<UID, Pos> {
  // Compute unique sorted timestamps (time steps)
  const timestamps = [...new Set(actions.map((a) => a.timestamp))].sort((a, b) => a - b);
  const timeIndex = new Map(timestamps.map((ts, i) => [ts, i]));

  const positions = new Map<UID, Pos>();

  if (mode === 'location') {
    // Group by location
    const locations = [...new Set(actions.map((a) => a.location))].sort();
    const locationMap = new Map(locations.map((loc, i) => [loc, i]));

    // Within each location, sort by timestamp
    const locationActions = new Map<UID, ActionView[]>();
    for (const action of actions) {
      if (!locationActions.has(action.location)) {
        locationActions.set(action.location, []);
      }
      locationActions.get(action.location)!.push(action);
    }

    // Assign positions
    for (const [location, locActions] of locationActions) {
      const laneIdx = locationMap.get(location) ?? 0;
      const baseLaneY = laneIdx * LANE_HEIGHT;

      // Group by time step
      const byTime = new Map<number, ActionView[]>();
      for (const action of locActions) {
        const stepIdx = timeIndex.get(action.timestamp) ?? 0;
        if (!byTime.has(stepIdx)) byTime.set(stepIdx, []);
        byTime.get(stepIdx)!.push(action);
      }

      // Within same time, stack vertically
      for (const [stepIdx, timeActions] of byTime) {
        timeActions.forEach((action, subRow) => {
          positions.set(action.id, {
            col: stepIdx,
            row: baseLaneY + subRow * (NODE_HEIGHT + 10),
          });
        });
      }
    }
  } else if (mode === 'character') {
    // Group by character (initiator)
    const characters = [...new Set(actions.map((a) => a.initiator))].sort();
    const charMap = new Map(characters.map((char, i) => [char, i]));

    // Within each character, sort by timestamp
    const charActions = new Map<UID, ActionView[]>();
    for (const action of actions) {
      if (!charActions.has(action.initiator)) {
        charActions.set(action.initiator, []);
      }
      charActions.get(action.initiator)!.push(action);
    }

    // Assign positions
    for (const [char, charActs] of charActions) {
      const laneIdx = charMap.get(char) ?? 0;
      const baseLaneY = laneIdx * LANE_HEIGHT;

      const byTime = new Map<number, ActionView[]>();
      for (const action of charActs) {
        const stepIdx = timeIndex.get(action.timestamp) ?? 0;
        if (!byTime.has(stepIdx)) byTime.set(stepIdx, []);
        byTime.get(stepIdx)!.push(action);
      }

      for (const [stepIdx, timeActions] of byTime) {
        timeActions.forEach((action, subRow) => {
          positions.set(action.id, {
            col: stepIdx,
            row: baseLaneY + subRow * (NODE_HEIGHT + 10),
          });
        });
      }
    }
  } else if (mode === 'both') {
    // Nested: location groups, characters as sub-lanes
    const locations = [...new Set(actions.map((a) => a.location))].sort();
    const locationMap = new Map(locations.map((loc, i) => [loc, i]));

    // Build location → characters mapping
    const locCharMap = new Map<UID, Set<UID>>();
    for (const action of actions) {
      if (!locCharMap.has(action.location)) {
        locCharMap.set(action.location, new Set());
      }
      locCharMap.get(action.location)!.add(action.initiator);
    }

    // Assign lane indices
    let laneIdx = 0;
    const laneMap = new Map<string, number>(); // key: "location|character"
    const locationBaseRow = new Map<UID, number>();

    for (const location of locations) {
      locationBaseRow.set(location, laneIdx * LANE_HEIGHT);
      const chars = [...(locCharMap.get(location) ?? [])].sort();
      for (const char of chars) {
        laneMap.set(`${location}|${char}`, laneIdx);
        laneIdx++;
      }
    }

    // Assign positions
    for (const action of actions) {
      const laneKey = `${action.location}|${action.initiator}`;
      const laneIdx = laneMap.get(laneKey) ?? 0;
      const baseLaneY = laneIdx * LANE_HEIGHT;

      const stepIdx = timeIndex.get(action.timestamp) ?? 0;
      positions.set(action.id, {
        col: stepIdx,
        row: baseLaneY,
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
