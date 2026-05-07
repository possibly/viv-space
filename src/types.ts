export type UID = string;
export type EntityType = "character" | "location" | "item" | "action";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night" | "dawn" | "dusk";

export interface BaseEntityView {
  entityType: EntityType;
  id: UID;
  name?: string;
  [key: string]: unknown;
}

export interface CharacterView extends BaseEntityView {
  entityType: "character";
  location: UID;
  memories: Record<UID, CharacterMemory>;
}

export interface CharacterMemory {
  action: UID;
  formationTimestamp: number;
  salience: number;
  associations: string[];
  sources: UID[];
  forgotten: boolean;
}

export interface ItemView extends BaseEntityView {
  entityType: "item";
  location: UID;
  inscriptions: UID[];
}

export interface LocationView extends BaseEntityView {
  entityType: "location";
}

export interface ActionView extends BaseEntityView {
  entityType: "action";
  name: string;
  gloss: string | null;
  report: string | null;
  importance: number;
  tags: string[];
  bindings: Record<string, UID | string>;
  scratch: Record<string, unknown>;
  location: UID;
  timestamp: number;
  timeOfDay: TimeOfDay | null;
  causes: UID[];
  caused: UID[];
  ancestors: UID[];
  descendants: UID[];
  relayedActions: UID[];
  initiator: UID;
  partners: UID[];
  recipients: UID[];
  bystanders: UID[];
  active: UID[];
  present: UID[];
}

export type EntityView = CharacterView | ItemView | LocationView | ActionView;

export interface QueuedAction {
  type: "action";
  constructName: string;
  id: UID;
  urgent: boolean;
  precastBindings: Record<string, UID>;
  causes: UID[];
  initiator: UID;
  priority: number;
}

export interface QueuedPlan {
  type: "plan";
  constructName: string;
  id: UID;
  urgent: boolean;
  precastBindings: Record<string, UID>;
  causes: UID[];
}

export interface PlanState {
  planName: string;
  phase: string;
  bindings: Record<string, UID>;
  causes: UID[];
  status: string;
}

export interface VivInternalState {
  actionQueues: Record<UID, (QueuedAction | { type: string; [k: string]: unknown })[]>;
  planQueue: (QueuedPlan | { type: string; [k: string]: unknown })[];
  activePlans: Record<UID, PlanState>;
  queuedConstructStatuses: Record<UID, string>;
  actionEmbargoes: Record<string, unknown>;
  lastMemoryDecayTimestamp: number | null;
}

export interface VivSnapshot {
  schemaVersion: string;
  timestamp: number;
  entities: Record<UID, EntityView>;
  vivInternalState: VivInternalState;
}

// ─── Graph types ────────────────────────────────────────────────────────────

export interface NodePosition {
  x: number;
  y: number;
}

export interface GraphNode {
  id: UID;
  action: ActionView;
  x: number;
  y: number;
  width: number;
  height: number;
  /** character color derived from initiator */
  color: string;
}

export interface GraphEdge {
  from: UID;
  to: UID;
}

export interface GraphData {
  nodes: Map<UID, GraphNode>;
  edges: GraphEdge[];
}

// ─── UI state ───────────────────────────────────────────────────────────────

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface AppState {
  snapshot: VivSnapshot | null;
  graph: GraphData | null;
  viewport: Viewport;
  selectedNodeId: UID | null;
  hoveredNodeId: UID | null;
  isDragging: boolean;
  dragStart: { x: number; y: number; vx: number; vy: number } | null;
  filterCharacter: string | null;
  filterTag: string | null;
  showPlans: boolean;
  showQueues: boolean;
  layoutMode: 'dag' | 'location' | 'character';
}
