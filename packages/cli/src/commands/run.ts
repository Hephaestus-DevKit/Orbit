import {
  applyPermissionModePreset,
  ConfigLoader,
  DEFAULT_CONFIG,
  isFullAccessEnabled,
  discoverAgentProfiles,
  resolveAgentProfile,
  MAX_AGENT_MAX_ITERATIONS,
  type OrbitConfig,
} from "@orbit-build/config";
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

export function shouldUseStoredPermissionMode(cliOverrides: unknown): boolean {
  if (
    typeof cliOverrides !== "object" ||
    cliOverrides === null ||
    Array.isArray(cliOverrides)
  ) {
    return true;
  }
  const permissions = (cliOverrides as Record<string, unknown>).permissions;
  return !(
    typeof permissions === "object" &&
    permissions !== null &&
    !Array.isArray(permissions) &&
    typeof (permissions as Record<string, unknown>).mode === "string"
  );
}

export function shouldUseStoredAgentMaxIterations(
  cliOverrides: unknown,
): boolean {
  if (
    typeof cliOverrides !== "object" ||
    cliOverrides === null ||
    Array.isArray(cliOverrides)
  ) {
    return true;
  }
  const agent = (cliOverrides as Record<string, unknown>).agent;
  return !(
    typeof agent === "object" &&
    agent !== null &&
    !Array.isArray(agent) &&
    typeof (agent as Record<string, unknown>).maxIterations === "number"
  );
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

/** Return a validated one-shot Agent Profile name from CLI overrides. */
export function getExplicitAgentProfileOverride(
  cliOverrides: unknown,
): string | undefined {
  if (
    typeof cliOverrides !== "object" ||
    cliOverrides === null ||
    Array.isArray(cliOverrides)
  ) {
    return undefined;
  }
  const selected = (cliOverrides as Record<string, unknown>).agentProfile;
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
  if (
    shouldUseStoredPermissionMode(cliOverrides) &&
    localState.permissionMode
  ) {
    applyPermissionModePreset(config, localState.permissionMode);
  }
  if (
    shouldUseStoredAgentMaxIterations(cliOverrides) &&
    localState.agentMaxIterations
  ) {
    config.agent.maxIterations = Math.min(
      localState.agentMaxIterations,
      config.managedPolicy?.maxIterations ?? MAX_AGENT_MAX_ITERATIONS,
    );
  }
}

export interface RunAgentOptions {
  nonInteractive?: boolean;
  /** Continue periodic loop checkpoints; Full Access enables this implicitly. */
  autoContinueRunaway?: boolean;
  jsonl?: boolean;
  resumeSessionId?: string;
  /** Select a validated user/project Agent Profile for one task run. */
  agentProfile?: string;
  webUi?: {
    port?: number;
    /** @deprecated Orbit no longer opens a browser automatically. */
    open?: boolean;
  };
}

/** Resolve non-blocking loop checkpoints without approving individual tools. */
export function shouldAutoContinueRunaway(
  config: OrbitConfig,
  options?: RunAgentOptions,
): boolean {
  return isFullAccessEnabled(config) || options?.autoContinueRunaway === true;
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
    const explicitProviderOverride = getExplicitProviderOverride(cliOverrides);
    const explicitAgentProfileOverride =
      getExplicitAgentProfileOverride(cliOverrides);
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

    const agentSettings = config.agents ?? DEFAULT_CONFIG.agents;
    let selectedProfile:
      | ReturnType<typeof discoverAgentProfiles>["profiles"][number]
      | undefined;
    const profileName =
      options?.agentProfile?.trim() ||
      explicitAgentProfileOverride ||
      agentSettings.defaultProfile;
    if (profileName) {
      try {
        if (!agentSettings.enabled) {
          throw new Error(
            "Agent Profiles are disabled (agents.enabled: false).",
          );
        }
        const catalog = discoverAgentProfiles(cwd, agentSettings);
        selectedProfile = resolveAgentProfile(catalog, profileName, config, {
          allowPermissionEscalation: isFullAccessEnabled(config),
        });
        if (!explicitProviderOverride && selectedProfile.provider) {
          if (!config.providers[selectedProfile.provider]) {
            throw new Error(
              `Agent profile ${selectedProfile.name} references unknown provider ${selectedProfile.provider}.`,
            );
          }
          config.provider.default = selectedProfile.provider;
        }
        if (!explicitModelOverride && selectedProfile.model) {
          config.models.default = selectedProfile.model;
        }
        if (
          selectedProfile.permissionMode &&
          !(cliOverrides as Record<string, unknown> | undefined)?.permissions
        ) {
          const result = applyPermissionModePreset(
            config,
            selectedProfile.permissionMode,
          );
          if (!result.ok)
            throw new Error(
              result.message || "Agent profile permission mode is not allowed.",
            );
        }
        if (
          selectedProfile.maxTurns !== undefined &&
          shouldUseStoredAgentMaxIterations(cliOverrides)
        ) {
          config.agent.maxIterations = Math.min(
            selectedProfile.maxTurns,
            config.managedPolicy?.maxIterations ?? MAX_AGENT_MAX_ITERATIONS,
          );
        }
      } catch (error: unknown) {
        const message = redactSecrets(
          error instanceof Error ? error.message : String(error),
        );
        const outcome: AgentLoopRunOutcome = {
          status: "failed",
          sessionId: "",
          attempts: 0,
          error: { code: "execution_error", message },
        };
        eventBus.emitEvent("agent_completed", {
          taskId: "startup",
          success: false,
          result: outcome,
          error: message,
        });
        return outcome;
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
      if (selectedProfile) {
        throw new Error(
          "Agent Profiles currently apply to one-shot task runs; provide a task prompt.",
        );
      }
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
        selectedProfile,
      );
      return await orchestrator.run();
    } else {
      let loop: AgentLoop | undefined;
      try {
        loop = AgentLoop.initialize(
          cwd,
          config,
          providerInstance,
          activeTask,
          interaction,
          {
            modelOverride: explicitModelOverride,
            thinkingEffort: selectedProfile?.effort,
            sessionId: options?.resumeSessionId,
            requireSession: Boolean(options?.resumeSessionId),
            disableStatusBar: !!options?.nonInteractive || !!options?.jsonl,
            nonInteractive: !!options?.nonInteractive,
            autoContinueRunaway: shouldAutoContinueRunaway(config, options),
            allowedTools: selectedProfile?.allowedTools,
            disallowedTools: selectedProfile?.disallowedTools,
            forcedSkills: selectedProfile?.skills,
            memoryMode: selectedProfile?.memory,
            systemPromptOverride: selectedProfile?.systemPrompt,
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
      } finally {
        await loop?.dispose();
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
