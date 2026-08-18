import {
  Prompt,
  type PromptOption,
  type SelectWithDeleteResult,
} from "@orbit-build/tui";
import picocolors from "picocolors";
import type { OrbitMessage } from "@orbit-build/model-providers";
import {
  HANDLED_COMMAND,
  type CommandHandlerResult,
  type CommandOutput,
} from "./CommandHandlerTypes.js";

interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  model: string;
}

interface SessionLoop {
  getSessions(): SessionSummary[];
  getSessionId(): string;
  getHistory(): readonly OrbitMessage[];
  getModelOverride(): string | undefined;
  deleteSession(sessionId: string): void;
  resumeSession(sessionId: string): boolean;
  startNewSession(providerId: string, model: string): string;
}

function getActiveSessionId(loop: SessionLoop): string {
  return loop.getSessionId();
}

interface SessionTui {
  loadHistory(
    history: readonly OrbitMessage[],
    options?: { silent?: boolean },
  ): void;
}

interface SessionPromptAdapter {
  askSelectWithDelete(
    question: string,
    options: PromptOption[],
    config?: {
      initialSelectedValue?: string;
      suppressCloseRenderOnDelete?: boolean;
    },
  ): Promise<SelectWithDeleteResult>;
}

interface LocalSessionState {
  lastSessionId: string;
  lastModel: string;
}

export interface SessionCommandDependencies {
  language: "en" | "zh" | "zh-TW";
  providerId: string;
  defaultModel: string;
  useFullscreenTui: boolean;
  loop: SessionLoop;
  tui: SessionTui;
  printOutput: CommandOutput;
  saveLocalState(state: LocalSessionState): void;
  refreshCandidates(): Promise<void>;
  prompt?: SessionPromptAdapter;
}

function sessionOption(session: SessionSummary): PromptOption {
  const formattedDate = new Date(session.createdAt).toLocaleString();
  return {
    value: session.id,
    label: `${session.id} - ${session.title || "Untitled"} (${formattedDate}) [${session.model}]`,
  };
}

export function getNextSessionSelection(
  sessionsBeforeDelete: SessionSummary[],
  deletedId: string,
  emptyFallback?: string,
): string | undefined {
  const deletedIndex = sessionsBeforeDelete.findIndex(
    (session) => session.id === deletedId,
  );
  const remaining = sessionsBeforeDelete.filter(
    (session) => session.id !== deletedId,
  );
  if (remaining.length === 0) return emptyFallback;
  const nextIndex =
    deletedIndex < 0 ? 0 : Math.min(deletedIndex, remaining.length - 1);
  return remaining[nextIndex]?.id;
}

function resolveSessionId(
  input: string,
  sessions: SessionSummary[],
): string | null {
  const index = Number.parseInt(input, 10);
  if (Number.isInteger(index) && index >= 1 && index <= sessions.length) {
    return sessions[index - 1].id;
  }
  return sessions.some((session) => session.id === input) ? input : null;
}

function activeModel(dependencies: SessionCommandDependencies): string {
  return dependencies.loop.getModelOverride() || dependencies.defaultModel;
}

function saveActiveSession(
  dependencies: SessionCommandDependencies,
  sessionId: string,
): void {
  dependencies.saveLocalState({
    lastSessionId: sessionId,
    lastModel: activeModel(dependencies),
  });
}

function startNewSession(dependencies: SessionCommandDependencies): string {
  const model = activeModel(dependencies);
  const sessionId = dependencies.loop.startNewSession(
    dependencies.providerId,
    model,
  );
  dependencies.tui.loadHistory([]);
  dependencies.printOutput(
    picocolors.green(`✔ Started new session: ${sessionId}`),
  );
  dependencies.saveLocalState({ lastSessionId: sessionId, lastModel: model });
  return sessionId;
}

function switchSession(
  dependencies: SessionCommandDependencies,
  sessionId: string,
): boolean {
  if (!dependencies.loop.resumeSession(sessionId)) return false;
  dependencies.tui.loadHistory(dependencies.loop.getHistory());
  dependencies.printOutput(
    picocolors.green(`✔ Switched to session: ${sessionId}`),
  );
  saveActiveSession(dependencies, sessionId);
  return true;
}

function deleteSession(
  dependencies: SessionCommandDependencies,
  sessionId: string,
  quiet = false,
): void {
  const wasActive = getActiveSessionId(dependencies.loop) === sessionId;
  dependencies.loop.deleteSession(sessionId);
  if (!quiet) {
    dependencies.printOutput(
      picocolors.green(`✔ Session ${sessionId} deleted successfully.`),
    );
  }
  if (!wasActive) return;

  const [replacement] = dependencies.loop.getSessions();
  if (replacement && dependencies.loop.resumeSession(replacement.id)) {
    dependencies.tui.loadHistory(dependencies.loop.getHistory(), {
      silent: quiet && dependencies.useFullscreenTui,
    });
    if (!quiet) {
      dependencies.printOutput(
        picocolors.green(
          `✔ Automatically switched to session: ${replacement.id}`,
        ),
      );
    }
    saveActiveSession(dependencies, replacement.id);
    return;
  }

  const model = activeModel(dependencies);
  const newSessionId = dependencies.loop.startNewSession(
    dependencies.providerId,
    model,
  );
  dependencies.tui.loadHistory([], {
    silent: quiet && dependencies.useFullscreenTui,
  });
  if (!quiet) {
    dependencies.printOutput(
      picocolors.green(`✔ Automatically started new session: ${newSessionId}`),
    );
  }
  dependencies.saveLocalState({
    lastSessionId: newSessionId,
    lastModel: model,
  });
}

function listSessions(dependencies: SessionCommandDependencies): void {
  const sessions = dependencies.loop.getSessions();
  if (sessions.length === 0) {
    dependencies.printOutput(
      picocolors.yellow("No active or saved sessions found."),
    );
    return;
  }
  const activeSessionId = getActiveSessionId(dependencies.loop);
  const lines = sessions.map((session, index) => {
    const marker =
      session.id === activeSessionId ? picocolors.green("● (active)") : " ";
    return `  ${marker} [${index + 1}] ${picocolors.blue(session.id)} - ${session.title || "Untitled"} (${new Date(session.createdAt).toLocaleString()}) [${session.model}]`;
  });
  dependencies.printOutput(
    [
      picocolors.bold(picocolors.cyan("\n=== Orbit Saved Sessions ===\n")),
      ...lines,
      picocolors.cyan("============================\n"),
    ].join("\n"),
  );
}

async function deleteFromPicker(
  dependencies: SessionCommandDependencies,
): Promise<void> {
  const isZh = dependencies.language !== "en";
  let initialSelection: string | undefined;
  while (true) {
    const sessions = dependencies.loop.getSessions();
    if (sessions.length === 0) {
      dependencies.printOutput(
        picocolors.yellow("No active or saved sessions found to delete."),
      );
      return;
    }
    const options = sessions.map(sessionOption);
    options.push({
      value: "cancel",
      label: isZh ? "取消" : "Cancel",
      deleteDisabled: true,
    });
    const selection = await (dependencies.prompt ?? Prompt).askSelectWithDelete(
      isZh
        ? "选择会话，按 Del 标记，再按 Del 确认删除；Esc 退出:"
        : "Choose a session, press Del once to mark and Del again to delete; Esc exits:",
      options,
      {
        initialSelectedValue: initialSelection,
        suppressCloseRenderOnDelete: dependencies.useFullscreenTui,
      },
    );
    if (selection.action === "cancel") return;
    if (selection.action === "select") {
      dependencies.printOutput(
        picocolors.yellow(
          isZh
            ? "删除会话需要按 Del 标记，再按 Del 确认。"
            : "Press Del once to mark the session and Del again to delete it.",
        ),
      );
      continue;
    }
    initialSelection = getNextSessionSelection(sessions, selection.value);
    deleteSession(dependencies, selection.value, dependencies.useFullscreenTui);
  }
}

async function interactiveSessionPicker(
  dependencies: SessionCommandDependencies,
): Promise<void> {
  const isZh = dependencies.language !== "en";
  let initialSelection: string | undefined;
  while (true) {
    const sessions = dependencies.loop.getSessions();
    if (sessions.length === 0) {
      startNewSession(dependencies);
      return;
    }
    const options = sessions.map(sessionOption);
    options.unshift({
      value: "new",
      label: picocolors.green(isZh ? "+ 新建会话" : "+ Start a new session"),
      deleteDisabled: true,
    });
    options.push({
      value: "cancel",
      label: isZh ? "取消" : "Cancel",
      deleteDisabled: true,
    });
    const selection = await (dependencies.prompt ?? Prompt).askSelectWithDelete(
      isZh
        ? "选择会话，Enter 打开；会话行可按 Del 标记，再按 Del 删除；Esc 退出:"
        : "Choose a session. Enter opens it; Del marks a session and Del again deletes it; Esc exits:",
      options,
      {
        initialSelectedValue: initialSelection,
        suppressCloseRenderOnDelete: dependencies.useFullscreenTui,
      },
    );
    if (selection.action === "cancel") return;
    if (selection.action === "delete") {
      initialSelection = getNextSessionSelection(
        sessions,
        selection.value,
        "new",
      );
      deleteSession(
        dependencies,
        selection.value,
        dependencies.useFullscreenTui,
      );
      continue;
    }
    if (selection.value === "cancel") return;
    if (selection.value === "new") startNewSession(dependencies);
    else if (!switchSession(dependencies, selection.value)) {
      dependencies.printOutput(
        picocolors.red(`Failed to resume session: ${selection.value}`),
      );
    }
    return;
  }
}

/** Handles all `/chat` subcommands and the interactive session picker. */
export async function handleSessionCommand(
  subcommand: string | undefined,
  argument: string,
  dependencies: SessionCommandDependencies,
): Promise<CommandHandlerResult> {
  try {
    const normalized = subcommand?.toLowerCase();
    if (normalized === "list" || normalized === "ls") {
      listSessions(dependencies);
      return HANDLED_COMMAND;
    }

    if (["delete", "rm", "del"].includes(normalized ?? "")) {
      if (!argument) {
        await deleteFromPicker(dependencies);
        return HANDLED_COMMAND;
      }
      const sessionId = resolveSessionId(
        argument,
        dependencies.loop.getSessions(),
      );
      if (!sessionId) {
        dependencies.printOutput(
          picocolors.red(`✖ Session not found: ${argument}`),
        );
        return HANDLED_COMMAND;
      }
      deleteSession(dependencies, sessionId);
      return HANDLED_COMMAND;
    }

    if (normalized === "new" || normalized === "create") {
      startNewSession(dependencies);
      return HANDLED_COMMAND;
    }

    const sessions = dependencies.loop.getSessions();
    const implicitSession = normalized
      ? resolveSessionId(normalized, sessions)
      : null;
    if (normalized === "switch" || normalized === "load" || implicitSession) {
      const requested =
        normalized === "switch" || normalized === "load"
          ? argument
          : (implicitSession ?? "");
      if (!requested) {
        dependencies.printOutput(
          picocolors.yellow("Usage: /chat switch <session_id | index>"),
        );
        return HANDLED_COMMAND;
      }
      const sessionId = resolveSessionId(
        requested,
        dependencies.loop.getSessions(),
      );
      if (!sessionId) {
        dependencies.printOutput(
          picocolors.red(`✖ Session not found: ${requested}`),
        );
      } else if (!switchSession(dependencies, sessionId)) {
        dependencies.printOutput(
          picocolors.red(`✖ Failed to resume session: ${sessionId}`),
        );
      }
      return HANDLED_COMMAND;
    }

    await interactiveSessionPicker(dependencies);
    return HANDLED_COMMAND;
  } finally {
    try {
      await dependencies.refreshCandidates();
    } catch {
      // Session switching remains successful if optional autocomplete refresh fails.
    }
  }
}
