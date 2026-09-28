import { randomUUID } from "crypto";
import type { OrbitConfig } from "@orbit-build/config";
import {
  eventBus,
  type AgentLoop,
  type UserInteraction,
} from "@orbit-build/core";
import { redactSecrets } from "@orbit-build/shared";
import type { FullscreenTui } from "../../tui/FullscreenTui.js";
import {
  loadCustomCommands,
  type CustomCommand,
} from "../../commands/customCommands.js";
import { runWorkflowExport } from "../../commands/workflow.js";
import { BUILTIN_SLASH_COMMANDS } from "../SlashCommandCatalog.js";
import { runStructuredWorkflow } from "./WorkflowRunner.js";
import { WorkflowStore } from "./WorkflowStore.js";

export interface WorkflowCommandContext {
  cwd: string;
  config: OrbitConfig;
  loop: AgentLoop;
  tui: FullscreenTui;
  source: "terminal" | "web";
  interaction: UserInteraction;
  restoreInteraction: UserInteraction;
  print(text: string): void;
  rememberSession?(): void;
}
/** Shared terminal/WebUI entry point, including normal approvals and cancellation. */
export async function handleWorkflowCommand(
  input: string,
  context: WorkflowCommandContext,
): Promise<{ shouldExit: false; processed: true; error?: string }> {
  const done = { shouldExit: false as const, processed: true as const };
  try {
    const match = input.match(
      /^\/workflow\s+(export|run|resume|status|cancel)\s+(\S+)(?:\s+([\s\S]*))?$/i,
    );
    if (!match)
      throw new Error(
        "Usage: /workflow run <command> [input] | resume/status/cancel <run-id> | export <name> [local|versioned]",
      );
    const [, rawAction, name, args = ""] = match;
    const action = rawAction.toLowerCase();
    if (action === "export") {
      if (args && !["local", "versioned"].includes(args))
        throw new Error("Export scope must be local or versioned.");
      const result = await runWorkflowExport(
        context.cwd,
        context.loop.getSessionId(),
        { name, scope: (args || "local") as "local" | "versioned" },
      );
      context.loop.invalidateSkillsCache();
      context.print(
        `✔ Workflow Skill draft created: ${result.path}\nReview SKILL.md and set policy.review_status to approved in agents/openai.yaml, then refresh Skills. Automatic invocation remains off.`,
      );
      return done;
    }
    if (action !== "run" && args)
      throw new Error("Only workflow run accepts additional input.");
    const store = new WorkflowStore(context.cwd);
    const previous = action === "run" ? undefined : store.read(name);
    if (action === "status") {
      context.print(JSON.stringify(previous, null, 2));
      return done;
    }
    if (action === "cancel") {
      const release = store.acquire(true);
      try {
        const run = store.read(name);
        if (run.status === "completed")
          throw new Error("Completed workflows cannot be cancelled.");
        run.status = "cancelled";
        run.updatedAt = new Date().toISOString();
        for (const stage of run.stages)
          if (stage.status === "running") stage.status = "interrupted";
        store.save(run);
        context.print(
          `Workflow ${name} cancelled. Existing artifacts were preserved.`,
        );
      } finally {
        release();
      }
      return done;
    }
    const command: CustomCommand | undefined = loadCustomCommands(
      context.cwd,
      BUILTIN_SLASH_COMMANDS,
    ).find((item) => item.name === (previous?.command ?? name));
    if (!command?.stages)
      throw new Error(
        "No structured workflow with this name. Add stages to the command frontmatter; legacy prompt commands run directly with /<name>.",
      );
    if (context.tui.hasActiveRunnable())
      throw new Error(
        "Wait for the current task to finish before starting a workflow.",
      );
    const abort = new AbortController();
    const runnable = {
      abort: (mode?: "prompt" | "immediate") => {
        abort.abort();
        context.loop.abort(mode);
      },
    };
    context.tui.setActiveRunnable(runnable);
    context.loop.setUserInteraction(context.interaction);
    if (context.source === "terminal") context.tui.startThinkingInput();
    const turnId = randomUUID();
    let turnStatus: "completed" | "failed" | "aborted" = "failed";
    eventBus.emitEvent("ui_turn_started", {
      turnId,
      source: context.source,
      prompt: `Workflow /${command.name}`,
    });
    try {
      const run = await runStructuredWorkflow({
        cwd: context.cwd,
        config: context.config.skills,
        command,
        input: args,
        sessionId: context.loop.getSessionId(),
        resumeId: previous?.id,
        signal: abort.signal,
        execute: async (prompt) => {
          context.loop.invalidateSkillsCache();
          context.loop.prepareUserTurn(prompt);
          context.rememberSession?.();
          try {
            return await context.loop.run();
          } finally {
            context.tui.syncFromLoop(context.loop);
            context.tui.finishAttempt();
          }
        },
      });
      turnStatus =
        run.status === "completed"
          ? "completed"
          : run.status === "interrupted"
            ? "aborted"
            : "failed";
      context.print(
        `Workflow ${run.id}: ${run.status}\n${run.stages.map((stage) => `${stage.id}: ${stage.status}${stage.error ? ` — ${stage.error}` : ""}`).join("\n")}`,
      );
      return run.status === "completed"
        ? done
        : {
            ...done,
            error: `Workflow ${run.id} ${run.status}. Inspect /workflow status ${run.id}; explicitly resume when ready.`,
          };
    } finally {
      eventBus.emitEvent("ui_turn_completed", {
        turnId,
        source: context.source,
        status: turnStatus,
      });
      if (context.source === "terminal") context.tui.stopThinkingInput();
      context.loop.setUserInteraction(context.restoreInteraction);
      context.tui.setActiveRunnable(null);
    }
  } catch (error: unknown) {
    const message = redactSecrets(
      error instanceof Error ? error.message : String(error),
    );
    context.print(`✖ ${message}`);
    return { ...done, error: message };
  }
}
