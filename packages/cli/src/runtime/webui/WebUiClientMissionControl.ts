import type { WebUiMissionControlSnapshot } from "./WebUiContracts.js";

interface MissionControlCopy {
  running: string;
  ready: string;
  untitledTask: string;
  cost: string;
  noAgents: string;
  steeringCount: string;
  steerAgent: string;
  abortAgent: string;
  agentSteerPlaceholder: string;
  sendAgentSteering: string;
  cancelAgentSteering: string;
  resumeAgent: string;
}

interface MissionControlElements {
  taskOverview: HTMLElement;
  agentRunCount: HTMLElement;
  agentRunList: HTMLElement;
}

interface MissionControlState {
  agentSteeringId: string | null;
  agentSteeringDraft: string;
}

interface MissionControlRuntime {
  copy: MissionControlCopy;
  elements: MissionControlElements;
  state: MissionControlState;
  language: "en" | "zh" | "zh-TW";
  chinese: (simplified: string, traditional: string) => string;
}

/**
 * Strictly typed browser module factory. It is self-contained so its emitted
 * function can be serialized into Orbit's local same-origin client asset.
 */
function createMissionControl(runtime: MissionControlRuntime) {
  const { copy, elements, state, language, chinese } = runtime;

  function renderTaskOverview(data: WebUiMissionControlSnapshot): void {
    const session = data.session;
    const plan = data.plan;
    const runs = data.agentRuns;
    const agents = runs.flatMap((run) => run.agents);
    const activeAgents = agents.filter(
      (agent) => agent.status === "running",
    ).length;
    const backgroundTasks = data.backgroundTasks;
    const activeBackgroundTasks = backgroundTasks.filter(
      (task) => task.status === "running",
    ).length;
    const activeSession = session.recent.find((candidate) => candidate.active);
    const active = Boolean(data.turn?.active);
    const workActive = active || activeAgents > 0 || activeBackgroundTasks > 0;
    const statusLabel = workActive
      ? copy.running
      : agents.some((agent) => agent.status === "blocked")
        ? language === "en"
          ? "Blocked"
          : chinese("已阻塞", "已阻塞")
        : copy.ready;
    const titleText = activeSession?.title || copy.untitledTask;
    const goalText =
      session.goal ||
      (language === "en"
        ? "Add a durable goal with /goal so Orbit can keep long work aligned."
        : chinese(
            "使用 /goal 添加持续目标，让 Orbit 在长任务中保持方向。",
            "使用 /goal 加入持續目標，讓 Orbit 在長任務中保持方向。",
          ));
    const progress =
      Number(plan.count) > 0
        ? Math.round((Number(plan.completed) / Number(plan.count)) * 100)
        : 0;

    const card = document.createElement("article");
    card.className = `task-overview-card${workActive ? " is-running" : ""}`;
    const heading = document.createElement("div");
    heading.className = "task-overview-title";
    const title = document.createElement("strong");
    title.textContent = titleText;
    title.title = titleText;
    const status = document.createElement("span");
    status.className = "task-overview-status";
    status.textContent = statusLabel;
    heading.append(title, status);
    const goal = document.createElement("p");
    goal.textContent = goalText;
    const stats = document.createElement("dl");
    stats.className = "task-overview-stats";
    const rows: Array<readonly [string, string, string]> = [
      [
        language === "en" ? "Plan" : chinese("计划", "計畫"),
        `${Number(plan.completed)} / ${Number(plan.count)}`,
        `${progress}%`,
      ],
      [
        language === "en" ? "Agents" : chinese("智能体", "智慧體"),
        `${activeAgents} / ${agents.length}`,
        [activeAgents ? copy.running : "", data.agentTeam.preset]
          .filter(Boolean)
          .join(" · ") || copy.ready,
      ],
      [
        language === "en" ? "Background" : chinese("后台任务", "背景任務"),
        `${activeBackgroundTasks} / ${backgroundTasks.length}`,
        activeBackgroundTasks ? copy.running : copy.ready,
      ],
      [
        copy.cost,
        `$${Number(session.cost).toFixed(4)}`,
        data.activeModel || "—",
      ],
    ];
    for (const [label, value, detail] of rows) {
      const item = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      const small = document.createElement("small");
      term.textContent = label;
      description.textContent = value;
      small.textContent = detail;
      item.append(term, description, small);
      stats.append(item);
    }
    card.append(heading, goal, stats);
    elements.taskOverview.replaceChildren(card);
  }

  function renderAgentRuns(
    value: WebUiMissionControlSnapshot["agentRuns"],
  ): void {
    const agents = value.flatMap((run) =>
      run.agents.map((agent) => ({
        ...agent,
        runId: run.id,
      })),
    );
    const runningAgentIds = new Set(
      agents
        .filter((agent) => agent.status === "running")
        .map((agent) => agent.id),
    );
    if (state.agentSteeringId && !runningAgentIds.has(state.agentSteeringId)) {
      state.agentSteeringId = null;
      state.agentSteeringDraft = "";
    }
    elements.agentRunCount.textContent = String(agents.length);
    elements.agentRunList.replaceChildren();
    if (agents.length === 0) {
      const empty = document.createElement("p");
      empty.className = "review-empty";
      empty.textContent = copy.noAgents;
      elements.agentRunList.append(empty);
      return;
    }
    for (const agent of agents.slice(0, 24)) {
      const card = document.createElement("article");
      card.className = `agent-card is-${agent.status || "pending"}`;
      const heading = document.createElement("div");
      heading.className = "agent-card-heading";
      const title = document.createElement("strong");
      title.textContent = agent.role || "agent";
      const status = document.createElement("span");
      status.className = "agent-status";
      status.textContent = agent.status || "pending";
      heading.append(title, status);
      const task = document.createElement("p");
      task.textContent = agent.task;
      task.title = agent.task;
      const meta = document.createElement("div");
      meta.className = "agent-meta";
      meta.textContent = [
        agent.model,
        agent.access,
        `$${Number(agent.costUsd).toFixed(4)} / $${Number(agent.budgetUsd).toFixed(2)}`,
        agent.steeringCount > 0
          ? `${copy.steeringCount} ${agent.steeringCount}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      card.append(heading, task, meta);
      if (agent.status === "running") {
        const actions = document.createElement("div");
        actions.className = "agent-actions";
        const steer = createAgentButton(
          "agent-steer",
          "open-steer",
          agent.id,
          copy.steerAgent,
          agent.role,
        );
        const abort = createAgentButton(
          "agent-abort",
          "abort",
          agent.id,
          copy.abortAgent,
          agent.role,
        );
        actions.append(steer, abort);
        card.append(actions);
        if (state.agentSteeringId === agent.id) {
          card.append(createSteeringEditor(agent.id, agent.role));
        }
      } else if (agent.status !== "completed" && agent.sessionId) {
        const actions = document.createElement("div");
        actions.className = "agent-actions";
        const resume = createAgentButton(
          "agent-resume",
          "resume",
          agent.id,
          copy.resumeAgent,
          agent.role,
        );
        resume.dataset.runId = agent.runId;
        actions.append(resume);
        card.append(actions);
      }
      elements.agentRunList.append(card);
    }
  }

  function createAgentButton(
    className: string,
    action: string,
    agentId: string,
    label: string,
    role: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.agentAction = action;
    button.dataset.agentId = agentId;
    button.textContent = label;
    button.setAttribute("aria-label", `${label}: ${role || "agent"}`);
    return button;
  }

  function createSteeringEditor(agentId: string, role: string): HTMLElement {
    const editor = document.createElement("div");
    editor.className = "agent-steer-editor";
    const textarea = document.createElement("textarea");
    textarea.className = "agent-steer-input";
    textarea.dataset.agentSteerEditor = agentId;
    textarea.maxLength = 8_000;
    textarea.rows = 3;
    textarea.value = state.agentSteeringDraft;
    textarea.placeholder = copy.agentSteerPlaceholder;
    textarea.setAttribute(
      "aria-label",
      `${copy.steerAgent}: ${role || "agent"}`,
    );
    const actions = document.createElement("div");
    actions.className = "agent-steer-buttons";
    actions.append(
      createAgentButton(
        "agent-steer-send",
        "submit-steer",
        agentId,
        copy.sendAgentSteering,
        role,
      ),
      createAgentButton(
        "agent-steer-cancel",
        "cancel-steer",
        agentId,
        copy.cancelAgentSteering,
        role,
      ),
    );
    editor.append(textarea, actions);
    return editor;
  }

  return { renderTaskOverview, renderAgentRuns };
}

/** Mission Control task summary and durable child-agent controls. */
export const WEB_UI_CLIENT_MISSION_CONTROL_SCRIPT =
  `  const { renderTaskOverview, renderAgentRuns } = ` +
  `(${createMissionControl.toString()})({ copy, elements, state, language, chinese });\n\n`;
