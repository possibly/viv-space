import type { ActionView, AppState, GraphData, VivSnapshot } from "./types";

// ─── Sidebar: characters, tags, plans panel ──────────────────────────────────

export function buildSidebar(
  container: HTMLElement,
  snapshot: VivSnapshot,
  state: AppState,
  onChange: () => void
): void {
  container.innerHTML = "";

  // ── Characters ──────────────────────────────────────────────
  const chars = Object.values(snapshot.entities).filter(
    (e) => e.entityType === "character"
  );

  if (chars.length > 0) {
    const section = document.createElement("div");
    section.className = "sidebar-section";
    section.innerHTML = `<div class="sidebar-label">Characters</div>`;

    for (const char of chars) {
      const btn = document.createElement("button");
      btn.className = "sidebar-chip" + (state.filterCharacter === char.id ? " active" : "");
      btn.textContent = (char.name as string) ?? char.id;
      btn.dataset["charId"] = char.id;
      btn.addEventListener("click", () => {
        state.filterCharacter = state.filterCharacter === char.id ? null : char.id;
        onChange();
      });
      section.appendChild(btn);
    }
    container.appendChild(section);
  }

  // ── Tags ─────────────────────────────────────────────────────
  const allTags = new Set<string>();
  for (const e of Object.values(snapshot.entities)) {
    if (e.entityType === "action") {
      for (const tag of (e as ActionView).tags) allTags.add(tag);
    }
  }

  if (allTags.size > 0) {
    const section = document.createElement("div");
    section.className = "sidebar-section";
    section.innerHTML = `<div class="sidebar-label">Tags</div>`;

    for (const tag of [...allTags].sort()) {
      const btn = document.createElement("button");
      btn.className = "sidebar-chip tag-chip" + (state.filterTag === tag ? " active" : "");
      btn.textContent = tag;
      btn.addEventListener("click", () => {
        state.filterTag = state.filterTag === tag ? null : tag;
        onChange();
      });
      section.appendChild(btn);
    }
    container.appendChild(section);
  }

  // ── Toggle options ──────────────────────────────────────────
  const optSection = document.createElement("div");
  optSection.className = "sidebar-section";
  optSection.innerHTML = `<div class="sidebar-label">Display</div>`;

  const queuesToggle = makeToggle("Show pending queues", state.showQueues, (v) => {
    state.showQueues = v;
    onChange();
  });
  optSection.appendChild(queuesToggle);

  const plansToggle = makeToggle("Highlight plans", state.showPlans, (v) => {
    state.showPlans = v;
    onChange();
  });
  optSection.appendChild(plansToggle);

  container.appendChild(optSection);

  // ── Plans panel ─────────────────────────────────────────────
  const { activePlans, planQueue } = snapshot.vivInternalState;
  const allPlans = [
    ...Object.entries(activePlans).map(([id, p]) => ({
      id,
      name: (p as { planName?: string }).planName ?? "?",
      status: "active",
      phase: (p as { phase?: string }).phase ?? "?",
    })),
    ...planQueue.map((p) => ({
      id: (p as { id?: string }).id ?? "?",
      name: (p as { constructName?: string }).constructName ?? "?",
      status: "queued",
      phase: "—",
    })),
  ];

  if (allPlans.length > 0) {
    const section = document.createElement("div");
    section.className = "sidebar-section";
    section.innerHTML = `<div class="sidebar-label">Plans</div>`;

    for (const plan of allPlans) {
      const card = document.createElement("div");
      card.className = "plan-card";
      card.innerHTML = `
        <div class="plan-name">${plan.name}</div>
        <div class="plan-meta">
          <span class="plan-status ${plan.status}">${plan.status}</span>
          ${plan.status === "active" ? `<span class="plan-phase">${plan.phase}</span>` : ""}
        </div>
      `;
      section.appendChild(card);
    }
    container.appendChild(section);
  }

  // ── Action queues summary ───────────────────────────────────
  const { actionQueues } = snapshot.vivInternalState;
  const queueEntries = Object.entries(actionQueues).filter(([, q]) => q.length > 0);
  if (queueEntries.length > 0) {
    const section = document.createElement("div");
    section.className = "sidebar-section";
    section.innerHTML = `<div class="sidebar-label">Action Queues</div>`;

    for (const [charId, queue] of queueEntries) {
      const charName = (snapshot.entities[charId]?.name as string) ?? charId;
      const section2 = document.createElement("div");
      section2.className = "queue-char";
      section2.innerHTML = `<div class="queue-char-name">${charName}</div>`;

      for (const item of queue) {
        const q = item as { constructName?: string; urgent?: boolean; priority?: number };
        const row = document.createElement("div");
        row.className = "queue-item" + (q.urgent ? " urgent" : "");
        row.innerHTML = `${q.urgent ? "🔴" : "🟡"} ${q.constructName ?? "?"} <span class="queue-priority">p=${q.priority ?? "?"}</span>`;
        section2.appendChild(row);
      }
      section.appendChild(section2);
    }
    container.appendChild(section);
  }
}

function makeToggle(
  label: string,
  initial: boolean,
  onChange: (val: boolean) => void
): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "toggle-row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = initial;
  input.addEventListener("change", () => onChange(input.checked));
  wrapper.appendChild(input);
  wrapper.appendChild(document.createTextNode(" " + label));
  return wrapper;
}

// ─── Apply filters to produce a visible subset ───────────────────────────────

export function applyFilters(
  graph: GraphData,
  state: AppState
): Set<string> {
  const visible = new Set<string>();

  for (const [id, node] of graph.nodes) {
    const action = node.action;
    if (state.filterCharacter && action.initiator !== state.filterCharacter) continue;
    if (state.filterTag && !action.tags.includes(state.filterTag)) continue;
    visible.add(id);
  }

  return visible;
}
