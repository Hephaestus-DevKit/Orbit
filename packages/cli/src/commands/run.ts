import { ConfigLoader, type OrbitConfig } from "@orbit-build/config";
import {
  AgentLoop,
  UserInteraction,
  Orchestrator,
  eventBus,
  ORBIT_EVENT_SCHEMA_VERSION,
  type AgentLoopRunOutcome,
} from "@orbit-build/core";
import { Prompt, DiffView, Renderer, StatusBar } from "@orbit-build/tui";
import picocolors from "picocolors";
import {
  previousCodePointIndex,
  nextCodePointIndex,
  parseMouseWheelDirection,
  pageText,
} from "../tui/FullscreenTui.js";
import { ReplController } from "../runtime/ReplController.js";
import { createProviderFromConfig } from "../runtime/ProviderFactory.js";
import { redactSecrets } from "@orbit-build/shared";
import type { ModelProvider } from "@orbit-build/model-providers";
import { ProjectRegistry } from "@orbit-build/session";
import {
  readLocalRuntimeState,
  type LocalRuntimeState,
} from "../runtime/LocalRuntimeState.js";

export { previousCodePointIndex, nextCodePointIndex, parseMouseWheelDirection };

export function shouldUseStoredModel(cliOverrides: unknown): boolean {
  return getExplicitModelOverride(cliOverrides) === undefined;
}

export function shouldUseStoredProvider(cliOverrides: unknown): boolean {
  return getExplicitProviderOverride(cliOverrides) === undefined;
}

/** Return a validated one-shot model override supplied by the CLI. */
export function getExplicitModelOverride(
  cliOverrides: unknown,
): string | undefined {
  if (
    typeof cliOverrides !== "object" ||
    cliOverrides === null ||
    Array.isArray(cliOverrides)
  ) {
    return undefined;
  }
  const models = (cliOverrides as Record<string, unknown>).models;
  if (typeof models !== "object" || models === null || Array.isArray(models)) {
    return undefined;
  }
  const selected = (models as Record<string, unknown>).default;
  if (typeof selected !== "string") return undefined;
  const normalized = selected.trim();
  return normalized || undefined;
}

/** Return a validated one-shot provider override supplied by the CLI. */
export function getExplicitProviderOverride(
  cliOverrides: unknown,
): string | undefined {
  if (
    typeof cliOverrides !== "object" ||
    cliOverrides === null ||
    Array.isArray(cliOverrides)
  ) {
    return undefined;
  }
  const provider = (cliOverrides as Record<string, unknown>).provider;
  if (
    typeof provider !== "object" ||
    provider === null ||
    Array.isArray(provider)
  ) {
    return undefined;
  }
  const selected = (provider as Record<string, unknown>).default;
  if (typeof selected !== "string") return undefined;
  const normalized = selected.trim();
  return normalized || undefined;
}

/** Restore a compatible persisted provider/model pair after config loading. */
export function applyStoredRuntimeSelection(
  config: OrbitConfig,
  localState: LocalRuntimeState,
  cliOverrides: unknown,
): void {
  if (
    shouldUseStoredProvider(cliOverrides) &&
    localState.lastProvider &&
    config.providers[localState.lastProvider]
  ) {
    config.provider.default = localState.lastProvider;
  }
  const storedModelMatchesProvider =
    !localState.lastProvider ||
    localState.lastProvider === config.provider.default;
  if (
    shouldUseStoredModel(cliOverrides) &&
    storedModelMatchesProvider &&
    localState.lastModel
  ) {
    config.models.default = localState.lastModel;
  }
}

export interface RunAgentOptions {
  nonInteractive?: boolean;
  jsonl?: boolean;
  resumeSessionId?: string;
  webUi?: {
    port?: number;
    /** @deprecated Orbit no longer opens a browser automatically. */
    open?: boolean;
  };
}

export async function runAgent(
  cwd: string,
  task?: string,
  cliOverrides?: Partial<OrbitConfig>,
  multi?: boolean,
  options?: RunAgentOptions,
): Promise<AgentLoopRunOutcome | undefined> {
  const cleanupJsonl = options?.jsonl ? configureJsonlOutput() : () => {};
  try {
    try {
      new ProjectRegistry().register(cwd);
    } catch (error: unknown) {
      eventBus.emitEvent("warning", {
        message: redactSecrets(
          error instanceof Error
            ? error.message
            : "Unable to update the project registry.",
        ),
      });
    }
    const config = ConfigLoader.loadSync(cwd, cliOverrides);
    const explicitModelOverride = getExplicitModelOverride(cliOverrides);
    applyStoredRuntimeSelection(
      config,
      readLocalRuntimeState(cwd),
      cliOverrides,
    );

    if (config.models) {
      if (config.models.default) {
        config.models.default = config.models.default.replace(
          /\x1b\[[0-9;]*[a-zA-Z]/g,
          "",
        );
      }
      if (config.models.fast) {
        config.models.fast = config.models.fast.replace(
          /\x1b\[[0-9;]*[a-zA-Z]/g,
          "",
        );
      }
    }

    let providerInstance: ModelProvider;
    try {
      providerInstance = createProviderFromConfig(config);
    } catch (error: unknown) {
      const message = redactSecrets(
        error instanceof Error
          ? error.message
          : "Failed to create provider instance.",
      );
      console.error(picocolors.red(message));
      const outcome: AgentLoopRunOutcome = {
        status: "failed",
        sessionId: "",
        attempts: 0,
        error: { code: "provider_error", message },
      };
      eventBus.emitEvent("agent_completed", {
        taskId: "startup",
        success: false,
        result: outcome,
        error: message,
      });
      return outcome;
    }

    const interaction: UserInteraction = options?.nonInteractive
      ? {
          async askApproval(
            reason: string,
            preview?: string,
          ): Promise<boolean> {
            console.error(`\nRisk Warning [Non-Interactive Mode]: ${reason}`);
            if (preview) {
              console.error(picocolors.gray(`Parameters: ${preview}`));
            }
            console.error(
              "Automatically denying action in non-interactive mode.",
            );
            return false;
          },
          showText(text: string): void {
            console.error(text);
          },
          async showDiff(
            filePath: string,
            _before: string | null,
            _after: string,
          ): Promise<void> {
            console.error(
              `[Diff for ${filePath} shown in non-interactive mode]`,
            );
          },
        }
      : {
          async askApproval(
            reason: string,
            preview?: string,
          ): Promise<boolean> {
            console.log(`\nRisk Warning: ${reason}`);
            if (preview) {
              console.log(picocolors.gray(`Parameters: ${preview}`));
            }
            return await Prompt.askApproval("Confirm action?");
          },
          showText(text: string): void {
            console.log(text);
          },
          async showDiff(
            filePath: string,
            before: string | null,
            after: string,
          ): Promise<void> {
            await pageText(DiffView.render(filePath, before, after));
          },
          prompt: Prompt,
          progress: new StatusBar(false),
          formatThought: Renderer.formatThought,
          formatMarkdown: Renderer.formatMarkdown,
        };

    const activeTask = task;
    if (!activeTask) {
      const controller = new ReplController(
        cwd,
        config,
        providerInstance,
        interaction,
        multi,
        !!cliOverrides?.direct,
        options?.webUi,
      );
      await controller.start();
      return;
    }

    if (multi) {
      const orchestrator = new Orchestrator(
        cwd,
        config,
        providerInstance,
        activeTask,
        interaction,
      );
      return await orchestrator.run();
    } else {
      try {
        const loop = AgentLoop.initialize(
          cwd,
          config,
          providerInstance,
          activeTask,
          interaction,
          {
            modelOverride: explicitModelOverride,
            sessionId: options?.resumeSessionId,
            requireSession: Boolean(options?.resumeSessionId),
            disableStatusBar: !!options?.nonInteractive || !!options?.jsonl,
            nonInteractive: !!options?.nonInteractive,
          },
        );
        return await loop.run();
      } catch (error: unknown) {
        const message = redactSecrets(
          error instanceof Error ? error.message : String(error),
        );
        const outcome: AgentLoopRunOutcome = {
          status: "failed",
          sessionId: options?.resumeSessionId || "",
          attempts: 0,
          error: { code: "execution_error", message },
        };
        eventBus.emitEvent("agent_completed", {
          taskId: options?.resumeSessionId || "startup",
          success: false,
          result: outcome,
          error: message,
        });
        return outcome;
      }
    }
  } finally {
    cleanupJsonl();
  }
}

/** Maps structured agent outcomes to stable process exit codes. */
export function exitCodeForOutcome(
  outcome: AgentLoopRunOutcome | undefined,
): number {
  if (!outcome || outcome.status === "completed") return 0;
  if (outcome.status === "aborted") return 130;
  if (outcome.error.code === "provider_error") return 4;
  return 2;
}

function configureJsonlOutput(): () => void {
  const originalLog = console.log;
  let sequence = 0;
  const onEvent = (event: unknown) => {
    const sanitized = sanitizeJsonlEvent(event);
    originalLog(
      JSON.stringify({
        schemaVersion: ORBIT_EVENT_SCHEMA_VERSION,
        sequence: ++sequence,
        timestamp: new Date().toISOString(),
        ...(isRecord(sanitized) ? sanitized : { type: "unknown", payload: {} }),
      }),
    );
  };
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };
  eventBus.on("*", onEvent);
  return () => {
    eventBus.off("*", onEvent);
    console.log = originalLog;
  };
}

function sanitizeJsonlEvent(event: unknown): unknown {
  if (!isRecord(event) || typeof event.type !== "string") return {};
  const payload = isRecord(event.payload) ? event.payload : {};
  const metadata = {
    ...(typeof event.eventId === "string" ? { eventId: event.eventId } : {}),
    ...(typeof event.timestamp === "string"
      ? { timestamp: event.timestamp }
      : {}),
  };
  switch (event.type) {
    case "model_request":
      return {
        ...metadata,
        type: event.type,
        payload: { model: payload.model },
      };
    case "model_response":
      return {
        ...metadata,
        type: event.type,
        payload: { model: payload.model, usage: payload.usage },
      };
    case "tool_proposal":
      return {
        ...metadata,
        type: event.type,
        payload: {
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          explanation: payload.explanation,
        },
      };
    case "tool_result":
      return {
        ...metadata,
        type: event.type,
        payload: {
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          error:
            typeof payload.error === "string"
              ? redactSecrets(payload.error)
              : payload.error,
        },
      };
    default:
      return redactJsonValue(event);
  }
}

function redactJsonValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactJsonValue(item)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
