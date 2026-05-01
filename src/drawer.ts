import type { ActionView, AppState, VivSnapshot } from "./types";
import { getEntityName } from "./renderer";

// ─── Drawer panel (HTML-based, overlaid on canvas) ──────────────────────────

export function createDrawer(): HTMLElement {
  const el = document.createElement("aside");
  el.id = "action-drawer";
  el.setAttribute("aria-label", "Action details");
  return el;
}

export function updateDrawer(
  drawer: HTMLElement,
  state: AppState
): void {
  if (!state.selectedNodeId || !state.snapshot || !state.graph) {
    drawer.classList.remove("open");
    return;
  }

  const node = state.graph.nodes.get(state.selectedNodeId);
  if (!node) {
    drawer.classList.remove("open");
    return;
  }

  const action = node.action;
  const snapshot = state.snapshot;

  drawer.innerHTML = buildDrawerHTML(action, snapshot, node.color);
  drawer.classList.add("open");

  // Close button
  drawer.querySelector(".drawer-close")?.addEventListener("click", () => {
    drawer.classList.remove("open");
  });
}

function buildDrawerHTML(
  action: ActionView,
  snapshot: VivSnapshot,
  color: string
): string {
  const initiatorName = getEntityName(action.initiator, snapshot);
  const locationName = getEntityName(action.location, snapshot);

  const causesHtml = action.causes.length
    ? action.causes
        .map((id) => actionRef(id, snapshot))
        .join(", ")
    : "<em>none</em>";

  const causedHtml = action.caused.length
    ? action.caused
        .map((id) => actionRef(id, snapshot))
        .join(", ")
    : "<em>none</em>";

  const tagsHtml = action.tags.length
    ? action.tags.map((t) => `<span class="tag">${t}</span>`).join(" ")
    : "<em>none</em>";

  const bindingsHtml = Object.entries(action.bindings)
    .map(([role, entityId]) => {
      const name = getEntityName(String(entityId), snapshot);
      return `<tr><td class="role-key">${role}</td><td class="role-val">${name} <span class="uid">${entityId}</span></td></tr>`;
    })
    .join("");

  const scratchHtml = Object.keys(action.scratch).length
    ? Object.entries(action.scratch)
        .map(([k, v]) => `<tr><td class="role-key">$${k}</td><td class="role-val">${JSON.stringify(v)}</td></tr>`)
        .join("")
    : "<tr><td colspan='2'><em>—</em></td></tr>";

  const presentHtml = action.present
    .map((id) => `<span class="person-chip">${getEntityName(id, snapshot)}</span>`)
    .join(" ");

  const impPct = Math.round(action.importance * 100);
  const impColor =
    action.importance >= 0.9 ? "#ff6b6b" : action.importance >= 0.7 ? "#ffd93d" : "#6bcb77";

  // Queue info for this action
  const queueInfo = getQueueInfo(action.id, snapshot);

  return `
<div class="drawer-header" style="border-left: 4px solid ${color}">
  <div class="drawer-title">
    <span class="action-name">${action.name}</span>
    <span class="action-ts">T=${action.timestamp}${action.timeOfDay ? " · " + action.timeOfDay : ""}</span>
  </div>
  <button class="drawer-close" aria-label="Close">✕</button>
</div>

<div class="drawer-body">

  <div class="drawer-section">
    <div class="gloss-text">${action.gloss ?? "(no gloss)"}</div>
  </div>

  ${action.report ? `<div class="drawer-section report-text">${action.report}</div>` : ""}

  <div class="drawer-section">
    <div class="section-label">Importance</div>
    <div class="importance-bar-wrap">
      <div class="importance-bar" style="width:${impPct}%;background:${impColor}"></div>
      <span class="importance-val">${impPct}%</span>
    </div>
  </div>

  <div class="drawer-section two-col">
    <div>
      <div class="section-label">Initiator</div>
      <span class="person-chip" style="color:${color}">${initiatorName}</span>
    </div>
    <div>
      <div class="section-label">Location</div>
      <span>${locationName}</span>
    </div>
  </div>

  <div class="drawer-section">
    <div class="section-label">Tags</div>
    <div>${tagsHtml}</div>
  </div>

  <div class="drawer-section">
    <div class="section-label">Present</div>
    <div>${presentHtml}</div>
  </div>

  <div class="drawer-section">
    <div class="section-label">Causes</div>
    <div>${causesHtml}</div>
  </div>

  <div class="drawer-section">
    <div class="section-label">Caused</div>
    <div>${causedHtml}</div>
  </div>

  <div class="drawer-section">
    <div class="section-label">Role Bindings</div>
    <table class="kv-table">${bindingsHtml}</table>
  </div>

  <div class="drawer-section">
    <div class="section-label">Scratch Variables</div>
    <table class="kv-table">${scratchHtml}</table>
  </div>

  ${queueInfo ? `<div class="drawer-section queue-info">${queueInfo}</div>` : ""}

  <div class="drawer-section stats-row">
    <div><span class="stat-num">${action.ancestors.length}</span> <span class="stat-label">ancestors</span></div>
    <div><span class="stat-num">${action.descendants.length}</span> <span class="stat-label">descendants</span></div>
    <div><span class="stat-num">${action.present.length}</span> <span class="stat-label">present</span></div>
  </div>

  <div class="drawer-section">
    <div class="section-label uid">ID: ${action.id}</div>
  </div>

</div>
`;
}

function actionRef(id: string, snapshot: VivSnapshot): string {
  const action = snapshot.entities[id];
  if (!action || action.entityType !== "action") return `<code>${id}</code>`;
  const a = action as ActionView;
  return `<button class="action-link" data-id="${id}">${a.name}</button>`;
}

function getQueueInfo(actionId: string, snapshot: VivSnapshot): string {
  const { actionQueues, activePlans, planQueue } = snapshot.vivInternalState;
  const lines: string[] = [];

  // Check if this action is referenced in queues
  for (const [charId, queue] of Object.entries(actionQueues)) {
    for (const item of queue) {
      const q = item as { causes?: string[]; constructName?: string; urgent?: boolean };
      if (q.causes?.includes(actionId)) {
        const charName = (snapshot.entities[charId]?.name as string) ?? charId;
        const urgency = q.urgent ? "🔴 urgent" : "🟡 queued";
        lines.push(`${urgency} <strong>${q.constructName}</strong> (by ${charName})`);
      }
    }
  }

  // Active plans caused by this action
  for (const [, plan] of Object.entries(activePlans)) {
    const p = plan as { causes?: string[]; planName?: string; phase?: string };
    if (p.causes?.includes(actionId)) {
      lines.push(`🟣 Active plan: <strong>${p.planName}</strong> (phase: ${p.phase})`);
    }
  }

  // Queued plans
  for (const item of planQueue) {
    const p = item as { causes?: string[]; constructName?: string };
    if (p.causes?.includes(actionId)) {
      lines.push(`🟣 Queued plan: <strong>${p.constructName}</strong>`);
    }
  }

  if (lines.length === 0) return "";
  return `<div class="section-label">Pending Continuations</div><ul class="queue-list">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`;
}
