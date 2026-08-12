import {
  AgentLoop,
  eventBus,
  ORCHESTRATED_AGENT_SESSION_PATH,
  Orchestrator,
  type AgentLoopRunOutcome,
  UserInteraction,
} from "@orbit-build/core";
import { FullscreenTui } from "../tui/FullscreenTui.js";
import {
  applyPermissionModePreset,
  ConfigSchema,
  localizeOrbit,
  parseOrbitLanguage,
  type OrbitConfig,
  validateManagedRuntimeChange,
} from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import { DiffView, Prompt } from "@orbit-build/tui";
import picocolors from "picocolors";
import {
  expandCustomCommand,
  loadCustomCommands,
} from "../commands/customCommands.js";
import {
  findMcpPromptCommand,
  parseMcpPromptArguments,
} from "./McpPromptCommands.js";
import {
  formatModelOptionLabel,
  getProviderModelCandidates,
  isOfficialDeepSeekProvider,
} from "./ModelCatalog.js";
import { createRequire } from "module";
import { buildDoctorReport } from "../commands/doctor.js";
import {
  parseWebUiArgs,
  startOrbitWebUi,
  type WebUiSessionAction,
  type WebUiSettingsPatch,
  type WebUiImageAttachment,
  type WebUiInputQueueAction,
  type WebUiTaskAction,
} from "./webui/index.js";
import { WebUiApprovalBroker } from "./webui/WebUiApprovalBroker.js";
import {
  AgentRunStore,
  ProjectRegistry,
  SessionManager,
} from "@orbit-build/session";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";
import { RunCoordinator } from "./RunCoordinator.js";
import {
  BUILTIN_SLASH_COMMANDS,
  buildSlashCommandHelp,
} from "./SlashCommandCatalog.js";
import {
  getAutocompleteCandidates,
  type AutocompleteCandidates,
} from "./AutocompleteCandidates.js";
import { handleShellCommand } from "./commands/ShellCommandHandler.js";
import { handleWorkspaceConfigCommand } from "./commands/WorkspaceConfigCommandHandler.js";
import { handleContextCommand } from "./commands/ContextCommandHandler.js";
import { handleRollbackCommand } from "./commands/RollbackCommandHandler.js";
import { handleSessionCommand } from "./commands/SessionCommandHandler.js";
import { ensureSessionTitle } from "./SessionTitles.js";
import { createProviderFromConfig } from "./ProviderFactory.js";
import { discoverProviderModels } from "./ModelDiscovery.js";
import {
  launchOrbitProject,
  PROJECT_WEB_UI_READY_MESSAGE,
} from "./ProjectLauncher.js";
import { selectOrbitProjectFolder } from "./ProjectFolderPicker.js";
import { handleSessionMetadataCommand } from "./commands/SessionMetadataCommandHandler.js";
import { handleWorkspaceStateCommand } from "./commands/WorkspaceStateCommandHandler.js";
import { handleInputQueueCommand } from "./commands/InputQueueCommandHandler.js";
import { runUpdate } from "../commands/update.js";
import { readCliVersion } from "./CliVersion.js";
import {
  buildReviewPrompt,
  parseReviewCommand,
} from "./review/ReviewCommand.js";
import { discoverSkills } from "@orbit-build/context-engine";
import type { LocalRuntimeState } from "./LocalRuntimeState.js";
import { randomUUID } from "crypto";

export { getAutocompleteCandidates } from "./AutocompleteCandidates.js";
export { BUILTIN_SLASH_COMMANDS } from "./SlashCommandCatalog.js";

const require = createRequire(import.meta.url);

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function terminalHyperlink(label: string, url: string): string {
  return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}

function getRunOutcomeMessage(
  outcome: AgentLoopRunOutcome | undefined,
): string | undefined {
  if (!outcome || outcome.status === "completed") return undefined;
  return outcome.status === "failed" ? outcome.error.message : outcome.message;
}

export class CommandRouter {
  private readonly runCoordinator = new RunCoordinator();
  private readonly webApprovalBroker = new WebUiApprovalBroker();
  private webUiRunnable: AgentLoop | Orchestrator | null = null;
  private webUiResumedAgentId: string | null = null;

  constructor(
    private cwd: string,
    private config: OrbitConfig,
    private providerInstance: ModelProvider,
    private setProviderInstance: (newProvider: ModelProvider) => void,
    private loop: AgentLoop,
    private tui: FullscreenTui,
    private useFullscreenTui: boolean,
    private getCandidates: () => AutocompleteCandidates | null,
    private setCandidates: (candidates: AutocompleteCandidates) => void,
    private getLocalState: () => LocalRuntimeState,
    private saveLocalState: (state: LocalRuntimeState) => void,
    private tuiInteraction: UserInteraction,
    private multi?: boolean,
    private updateOrbit: typeof runUpdate = runUpdate,
    private onProjectHandoff?: () => void,
  ) {}

  /** Acquires the shared agent loop for a terminal turn. */
  public beginTerminalRun(): (() => void) | undefined {
    return this.runCoordinator.acquire("terminal");
  }

  /** Reports whether the browser currently owns the shared agent loop. */
  public isWebUiBusy(): boolean {
    return this.runCoordinator.isActive("web");
  }

  private printOutput(text: string, raw = false) {
    if (this.tui && this.tui.isActive) {
      this.tui.addSystemMessage(text, raw);
    } else {
      console.log(text);
    }
    eventBus.emitEvent("info", { message: stripAnsi(text) });
  }

  private currentProviderId(): string | undefined {
    return this.config.provider?.default || this.providerInstance?.id;
  }

  public async route(
    input: string,
  ): Promise<{ shouldExit: boolean; processed: boolean; input?: string }> {
    let trimmed = input.trim();
    if (!trimmed) return { shouldExit: false, processed: false };

    const useFullscreenTui = this.useFullscreenTui;
    const tui = this.tui;
    const config = this.config;
    const loop = this.loop;
    const cwd = this.cwd;

    if (trimmed.startsWith("/")) {
      const commandName = trimmed.slice(1).split(/\s+/, 1)[0].toLowerCase();
      const customCommand = loadCustomCommands(
        cwd,
        BUILTIN_SLASH_COMMANDS,
      ).find((candidate) => candidate.name === commandName);
      if (customCommand) {
        const rawArguments = trimmed.slice(commandName.length + 1).trim();
        trimmed = expandCustomCommand(customCommand, rawArguments);
        tui.addLog(
          `${config.language !== "en" ? "已展开自定义命令" : "Expanded custom command"} /${customCommand.name}`,
        );
      }
    }

    if (trimmed.startsWith("/mcp__")) {
      const commandToken = trimmed.slice(1).split(/\s+/, 1)[0];
      const descriptor = findMcpPromptCommand(
        commandToken,
        loop.listMcpPrompts(),
      );
      if (descriptor) {
        const rawArguments = trimmed.slice(commandToken.length + 1).trim();
        try {
          trimmed = await loop.expandMcpPrompt(
            descriptor.serverName,
            descriptor.prompt.name,
            parseMcpPromptArguments(
              rawArguments,
              descriptor.prompt.arguments ?? [],
            ),
          );
          tui.addLog(
            `${config.language !== "en" ? "已展开 MCP prompt" : "Expanded MCP prompt"} /${commandToken}`,
          );
        } catch (error: unknown) {
          this.printOutput(
            picocolors.red(
              `✖ ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
          return { shouldExit: false, processed: true };
        }
      }
    }

    if (/^\/review(?:\s|$)/i.test(trimmed)) {
      try {
        const rawArguments = trimmed.replace(/^\/review\b/i, "").trim();
        const request = parseReviewCommand(rawArguments);
        trimmed = buildReviewPrompt(request);
        tui.addLog(
          config.language !== "en"
            ? `已启动 ${request.preset} 代码审查`
            : `Started ${request.preset} code review`,
        );
      } catch (error: unknown) {
        this.printOutput(
          picocolors.red(
            `✖ ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        return { shouldExit: false, processed: true };
      }
    }

    const shellResult = await handleShellCommand(trimmed, {
      cwd,
      config,
      loop,
      tui,
      useFullscreenTui,
    });
    if (shellResult) return shellResult;

    if (trimmed.startsWith("/")) {
      const parts = trimmed.split(" ");
      const command = parts[0].toLowerCase();

      const queueResult = handleInputQueueCommand(
        command,
        parts.slice(1).join(" ").trim(),
        {
          loop,
          language: config.language,
          canSteer: !this.multi && this.tui.hasActiveRunnable(),
          printOutput: (text) => this.printOutput(text),
        },
      );
      if (queueResult) return queueResult;

      const contextResult = await handleContextCommand(
        command,
        parts.slice(1).join(" ").trim(),
        {
          cwd,
          language: config.language,
          candidates: this.getCandidates(),
          loop,
          tui,
          useFullscreenTui,
          printOutput: (text, raw) => this.printOutput(text, raw),
        },
      );
      if (contextResult) return contextResult;

      const rollbackResult = await handleRollbackCommand(
        command,
        parts.slice(1).join(" ").trim(),
        {
          cwd,
          language: config.language,
          loop,
          printOutput: (text, raw) => this.printOutput(text, raw),
        },
      );
      if (rollbackResult) return rollbackResult;

      const workspaceStateResult = handleWorkspaceStateCommand(
        command,
        parts.slice(1).join(" ").trim(),
        {
          loop,
          isZh: config.language !== "en",
          printOutput: (text) => this.printOutput(text),
        },
      );
      if (workspaceStateResult) {
        this.tui.syncFromLoop(loop);
        return workspaceStateResult;
      }

      if (command === "/exit" || command === "/quit") {
        this.printOutput(
          picocolors.yellow("Exiting Orbit Interactive Shell. Goodbye!"),
        );
        return { shouldExit: true, processed: true };
      }

      if (command === "/help") {
        this.printOutput(buildSlashCommandHelp(config.language));
        return { shouldExit: false, processed: true };
      }

      if (
        handleSessionMetadataCommand(command, parts.slice(1).join(" ").trim(), {
          loop,
          isZh: config.language !== "en",
          printOutput: (text) => this.printOutput(text),
        })
      ) {
        this.tui.syncFromLoop(loop);
        return { shouldExit: false, processed: true };
      }

      if (command === "/webui") {
        const isZh = config.language !== "en";
        const { port } = parseWebUiArgs(parts.slice(1).join(" "));
        try {
          const handle = await startOrbitWebUi({
            cwd,
            config,
            loop,
            port,
            getProjects: () => new ProjectRegistry().list().slice(0, 20),
            getAgentRuns: () => {
              const store = new AgentRunStore(cwd);
              store.initialize();
              store.recoverInterruptedRuns();
              return store.listRuns(12);
            },
            submitPrompt: (prompt, attachments) =>
              this.submitWebPrompt(prompt, attachments),
            updateInputQueue: (action) => this.updateWebUiInputQueue(action),
            startTask: (action) => this.startWebUiTask(action),
            cancelPrompt: () => this.cancelWebPrompt(),
            updateSettings: (patch) => this.updateWebUiSettings(patch),
            updateSession: (action) => this.updateWebUiSession(action),
            updateReview: async (action) => {
              if (action.action === "rewind") {
                const ok = await loop.rewindToCheckpoint(action.checkpointId);
                this.tui.syncFromLoop(loop);
                return {
                  ok,
                  message: ok
                    ? "Workspace rewound to the selected checkpoint."
                    : "Orbit could not rewind to that checkpoint.",
                };
              }
              const ok = loop.rollbackFileToCheckpoint(action.path);
              this.tui.syncFromLoop(loop);
              return {
                ok,
                message: ok
                  ? `Restored ${action.path}.`
                  : `No restorable checkpoint was found for ${action.path}.`,
              };
            },
            controlAgent: (action) => {
              if (action.action === "resume") {
                return this.resumeWebUiAgent(action.runId, action.agentId);
              }
              const runnable = this.webUiRunnable;
              if (runnable instanceof Orchestrator) {
                if (
                  action.action === "abort" &&
                  runnable.abortAgent(action.agentId)
                ) {
                  return { ok: true, message: "Agent cancellation requested." };
                }
                if (
                  action.action === "steer" &&
                  runnable.steerAgent(action.agentId, action.prompt)
                ) {
                  return {
                    ok: true,
                    message: "Agent steering accepted for the next safe step.",
                  };
                }
              }
              if (
                runnable instanceof AgentLoop &&
                action.agentId === this.webUiResumedAgentId
              ) {
                if (action.action === "abort") {
                  runnable.abort("immediate");
                  return { ok: true, message: "Agent cancellation requested." };
                }
                runnable.enqueueUserInput(action.prompt, {
                  mode: "steer",
                  source: "web",
                });
                return {
                  ok: true,
                  message: "Agent steering accepted for the next safe step.",
                };
              }
              return {
                ok: false,
                message: "The selected agent is no longer running.",
              };
            },
            exportTrace: (includeHistory) =>
              loop.exportSessionTrace(includeHistory),
            openProject: async (action) => {
              if (action.action === "pick") {
                const path = await selectOrbitProjectFolder();
                return path
                  ? { ok: true, path }
                  : { ok: true, cancelled: true };
              }
              if (action.action === "remove") {
                const removed = new ProjectRegistry().remove(action.projectId);
                return {
                  ok: removed,
                  message: removed
                    ? "Project was removed from Orbit. Files were not deleted."
                    : "Project is no longer registered.",
                };
              }
              try {
                const launched = await launchOrbitProject(action);
                this.onProjectHandoff?.();
                return {
                  ok: true,
                  message: `Opening Orbit project: ${launched.path}`,
                  url: launched.url,
                };
              } catch (error: unknown) {
                return {
                  ok: false,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Orbit could not open the selected project.",
                };
              }
            },
            getPendingApproval: () => this.webApprovalBroker.getPending(),
            respondToApproval: (decision) =>
              this.webApprovalBroker.respond(decision),
            invalidateSkills: () => loop.invalidateSkillsCache(),
          });
          if (typeof process.send === "function" && process.connected) {
            try {
              process.send({
                type: PROJECT_WEB_UI_READY_MESSAGE,
                url: handle.url,
              });
            } catch {
              // The parent may disconnect after its startup timeout.
            }
          }
          const displayUrl = new URL(handle.url);
          displayUrl.hash = "";
          const statusText = isZh
            ? "✔ Orbit Web UI 已启动"
            : "✔ Orbit Web UI started";
          if (this.tui?.isActive) {
            this.tui.addSystemMessage(picocolors.green(statusText), false, {
              label: displayUrl.href,
              url: handle.url,
            });
          } else {
            console.log(
              [
                picocolors.green("✔"),
                terminalHyperlink(picocolors.cyan(displayUrl.href), handle.url),
                picocolors.dim("·"),
                picocolors.green(statusText.substring(1).trim()),
              ].join(" "),
            );
          }
          eventBus.emitEvent("info", {
            message: `${statusText}: ${displayUrl.href}`,
          });
          // Model discovery is useful for the browser selectors, but the
          // remote catalog must never delay the local server or its URL.
          void this.refreshProviderModels(config.provider.default, {
            timeoutMs: 2500,
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.printOutput(
            isZh
              ? picocolors.red(`✖ 无法启动 Orbit Web UI: ${message}`)
              : picocolors.red(`✖ Failed to start Orbit Web UI: ${message}`),
          );
        }
        return { shouldExit: false, processed: true };
      }

      if (command === "/update") {
        const isZh = config.language !== "en";
        const wasActive = useFullscreenTui && tui.isActive;
        const requestedFromWebUi = this.runCoordinator.isActive("web");
        try {
          const updateResult = await this.updateOrbit(
            readCliVersion(),
            { check: requestedFromWebUi },
            {
              interactive: true,
              confirm: (prompt) => Prompt.askApproval(prompt),
              write: (text) => this.printOutput(text),
              beforeInstall: () => {
                if (wasActive) tui.stop();
              },
              afterInstall: () => {
                tui.syncFromLoop(loop);
                if (wasActive) tui.start(config.budgetLimit);
              },
            },
          );
          tui.setOrbitUpdateAvailable?.(
            updateResult.restartRequired
              ? false
              : updateResult.check.updateAvailable,
          );
          if (updateResult.restartRequired) {
            tui.setOrbitRestartRequired?.(true);
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.printOutput(
            isZh
              ? picocolors.red(`✖ Orbit 更新失败: ${message}`)
              : picocolors.red(`✖ Orbit update failed: ${message}`),
          );
        }
        return { shouldExit: false, processed: true };
      }

      if (command === "/status") {
        const isZh = config.language !== "en";
        const activeConfig = loop.getConfig();
        const activeModel =
          loop.getModelOverride() || activeConfig.models.default;
        const routingMode = loop.getModelOverride() ? "LOCKED" : "AUTO";
        const memory = loop.getProjectMemory?.();
        const plan = loop.getTaskPlan?.();
        const budgetLimit = activeConfig.budgetLimit;
        const currentCost = loop.getSessionCost();
        const mode = activeConfig.permissions.mode;
        const contextStatus = loop.getContextWindowStatus(activeModel);
        const contextPct = Math.min(
          999,
          (contextStatus.estimatedHistoryTokens /
            contextStatus.compactAtTokens) *
            100,
        ).toFixed(1);
        const costPct =
          budgetLimit > 0
            ? Math.min(100, (currentCost / budgetLimit) * 100).toFixed(1)
            : "N/A";
        const barLen = 24;
        const filledLen =
          budgetLimit > 0
            ? Math.round((currentCost / budgetLimit) * barLen)
            : 0;
        const bar =
          picocolors.green("█".repeat(filledLen)) +
          picocolors.gray("░".repeat(Math.max(0, barLen - filledLen)));

        const statusLines = isZh
          ? [
              picocolors.bold("会话概况"),
              "",
              `  🆔  ${picocolors.gray("会话")}      ${picocolors.cyan(loop.getSessionId())}`,
              `  🔌  ${picocolors.gray("提供商")}    ${picocolors.cyan(this.providerInstance.id)}`,
              `  🤖  ${picocolors.gray("当前模型")}  ${picocolors.cyan(activeModel)}`,
              `  ↯   ${picocolors.gray("模型路由")}  ${picocolors.cyan(routingMode)}`,
              `  🛡️  ${picocolors.gray("权限模式")}  ${picocolors.green(mode.toUpperCase())}`,
              `  ◫   ${picocolors.gray("计划/记忆")}  ${picocolors.cyan(`${plan?.items.length || 0} / ${memory?.entries.length || 0}`)}`,
              ...(loop.getGoal()
                ? [
                    `  🎯  ${picocolors.gray("聊天目标")}  ${picocolors.cyan(loop.getGoal() || "")}`,
                  ]
                : []),
              `  🧠  ${picocolors.gray("上下文")}    ${picocolors.cyan(`~${contextStatus.estimatedHistoryTokens.toLocaleString()}`)} / ${contextStatus.maxContextTokens.toLocaleString()} tokens（${contextPct}% 自动压缩线）`,
              "",
              picocolors.bold("费用与预算"),
              "",
              `  💰  $${picocolors.yellow(currentCost.toFixed(4))} / $${picocolors.gray(budgetLimit.toFixed(2))}  (${costPct}%)`,
              `       ${bar}`,
            ]
          : [
              picocolors.bold("Session Overview"),
              "",
              `  🆔  ${picocolors.gray("Session ID")}    ${picocolors.cyan(loop.getSessionId())}`,
              `  🔌  ${picocolors.gray("Provider")}      ${picocolors.cyan(this.providerInstance.id)}`,
              `  🤖  ${picocolors.gray("Active Model")}  ${picocolors.cyan(activeModel)}`,
              `  ↯   ${picocolors.gray("Model Routing")} ${picocolors.cyan(routingMode)}`,
              `  🛡️  ${picocolors.gray("Security Mode")} ${picocolors.green(mode.toUpperCase())}`,
              `  ◫   ${picocolors.gray("Plan / Memory")} ${picocolors.cyan(`${plan?.items.length || 0} / ${memory?.entries.length || 0}`)}`,
              ...(loop.getGoal()
                ? [
                    `  🎯  ${picocolors.gray("Chat Goal")}     ${picocolors.cyan(loop.getGoal() || "")}`,
                  ]
                : []),
              `  🧠  ${picocolors.gray("Context")}       ${picocolors.cyan(`~${contextStatus.estimatedHistoryTokens.toLocaleString()}`)} / ${contextStatus.maxContextTokens.toLocaleString()} tokens (${contextPct}% of auto-compact threshold)`,
              "",
              picocolors.bold("Budget & Cost"),
              "",
              `  💰  $${picocolors.yellow(currentCost.toFixed(4))} / $${picocolors.gray(budgetLimit.toFixed(2))}  (${costPct}%)`,
              `       ${bar}`,
            ];

        this.printOutput(statusLines.join("\n"));
        return { shouldExit: false, processed: true };
      }

      if (command === "/doctor") {
        this.printOutput(buildDoctorReport(cwd, loop.getConfig()));
        return { shouldExit: false, processed: true };
      }

      if (command === "/config") {
        return handleWorkspaceConfigCommand(parts.slice(1).join(" ").trim(), {
          getConfig: () => loop.getConfig(),
          printOutput: (text, raw) => this.printOutput(text, raw),
        });
      }

      if (command === "/language") {
        const argument = parts.slice(1).join(" ").trim();
        let selected = argument ? parseOrbitLanguage(argument) : undefined;
        if (argument && !selected) {
          this.printOutput(
            picocolors.red(
              localizeOrbit(
                config.language,
                "Unknown language. Use en, zh, or zh-TW.",
                "未知语言。请使用 en、zh 或 zh-TW。",
                "未知語言。請使用 en、zh 或 zh-TW。",
              ),
            ),
          );
          return { shouldExit: false, processed: true };
        }
        if (!selected) {
          const choice = await Prompt.askSelect(
            localizeOrbit(
              config.language,
              "Choose the Orbit interface language:",
              "选择 Orbit 界面语言：",
              "選擇 Orbit 介面語言：",
            ),
            [
              { value: "en", label: "English" },
              { value: "zh", label: "简体中文" },
              { value: "zh-TW", label: "繁體中文" },
              {
                value: "cancel",
                label: localizeOrbit(config.language, "Cancel", "取消", "取消"),
              },
            ],
          );
          if (!choice || choice === "cancel") {
            return { shouldExit: false, processed: true };
          }
          selected = parseOrbitLanguage(choice);
        }
        if (!selected) return { shouldExit: false, processed: true };
        this.config.language = selected;
        this.saveLocalState({ language: selected });
        this.printOutput(
          `${picocolors.green("✔")} ${localizeOrbit(
            selected,
            "Language changed to English.",
            "语言已切换为简体中文。",
            "語言已切換為繁體中文。",
          )}`,
        );
        return { shouldExit: false, processed: true };
      }

      if (command === "/skills") {
        if (config.skills.enabled === false) {
          this.printOutput(
            picocolors.yellow(
              localizeOrbit(
                config.language,
                "Skills are disabled (skills.enabled: false).",
                "Skills 已停用（skills.enabled: false）。",
                "Skills 已停用（skills.enabled: false）。",
              ),
            ),
          );
          return { shouldExit: false, processed: true };
        }
        const catalog = await discoverSkills(cwd, config.skills);
        const heading = localizeOrbit(
          config.language,
          "Available Skills",
          "可用 Skills",
          "可用 Skills",
        );
        const available = catalog.skills.filter((skill) => !skill.disabled);
        const disabledSkills = catalog.skills.filter((skill) => skill.disabled);
        const explicitOnly = localizeOrbit(
          config.language,
          "explicit only",
          "仅显式调用",
          "僅顯式調用",
        );
        const lines = [
          picocolors.bold(picocolors.yellow(`[ ${heading} ]`)),
          ...(available.length
            ? available.map(
                (skill) =>
                  `  ${picocolors.green(`$${skill.name}`)} - ${
                    skill.shortDescription || skill.description
                  }${skill.allowImplicitInvocation ? "" : picocolors.gray(` (${explicitOnly})`)}`,
              )
            : [
                localizeOrbit(
                  config.language,
                  "  No valid Skills were found. Add one in WebUI Settings.",
                  "  未发现有效 Skill，可在 WebUI 设置中添加。",
                  "  未找到有效 Skill，可在 WebUI 設定中新增。",
                ),
              ]),
        ];
        if (disabledSkills.length) {
          lines.push(
            picocolors.gray(
              localizeOrbit(
                config.language,
                `  Disabled: ${disabledSkills.map((skill) => skill.name).join(", ")}`,
                `  已停用：${disabledSkills.map((skill) => skill.name).join("、")}`,
                `  已停用：${disabledSkills.map((skill) => skill.name).join("、")}`,
              ),
            ),
          );
        }
        if (catalog.diagnostics.length) {
          const shown = catalog.diagnostics.slice(0, 10);
          lines.push(
            picocolors.yellow(
              localizeOrbit(
                config.language,
                `${catalog.diagnostics.length} Skill diagnostic(s):`,
                `${catalog.diagnostics.length} 条 Skill 诊断：`,
                `${catalog.diagnostics.length} 條 Skill 診斷：`,
              ),
            ),
            ...shown.map((diagnostic) => {
              const paint =
                diagnostic.severity === "error"
                  ? picocolors.red
                  : picocolors.yellow;
              return `  ${paint(diagnostic.severity)} [${diagnostic.code}] ${diagnostic.message} (${diagnostic.path})`;
            }),
          );
          if (catalog.diagnostics.length > shown.length) {
            lines.push(
              picocolors.gray(
                `  … ${catalog.diagnostics.length - shown.length} more`,
              ),
            );
          }
        }
        this.printOutput(lines.join("\n"));
        return { shouldExit: false, processed: true };
      }

      if (command === "/model") {
        const modelArg = parts.slice(1).join(" ").trim();
        const activeConfig = loop.getConfig();
        const isZh = activeConfig.language !== "en";
        const announceModel = (model: string): void => {
          this.printOutput(
            `${picocolors.green("✔")} ${
              isZh
                ? `当前模型已切换为：${picocolors.green(model)}`
                : `Active model: ${picocolors.green(model)}`
            }`,
          );
        };
        if (!modelArg) {
          const providerOptions = Object.keys(activeConfig.providers).map(
            (providerId) => ({
              value: providerId,
              label: `${providerId}${providerId === this.providerInstance.id ? "  ✓" : ""}`,
            }),
          );
          providerOptions.push({
            value: "cancel",
            label: isZh ? "取消" : "Cancel",
          });
          const selectedProvider = await Prompt.askSelect(
            isZh
              ? `当前服务商：${this.providerInstance.id}。请选择模型服务商：`
              : `Current provider: ${this.providerInstance.id}. Select a model provider:`,
            providerOptions,
          );
          if (!selectedProvider || selectedProvider === "cancel") {
            return { shouldExit: false, processed: true };
          }
          const providerId = selectedProvider;
          const providerChanged = providerId !== this.providerInstance.id;
          const activeModel =
            loop.getModelOverride() || activeConfig.models.default;
          const createModelOptions = (): Array<{
            value: string;
            label: string;
          }> => [
            {
              value: "auto",
              label: isZh
                ? "自动路由（Flash / Pro 按任务选择）"
                : "Auto routing (Flash / Pro by task)",
            },
            ...getProviderModelCandidates(activeConfig, providerId).map(
              (model) => ({
                value: model,
                label: formatModelOptionLabel(model),
              }),
            ),
            {
              value: "refresh",
              label: isZh ? "刷新模型列表…" : "Refresh model catalog…",
            },
            {
              value: "custom",
              label: isZh ? "自定义模型名称…" : "Custom model name…",
            },
            { value: "cancel", label: isZh ? "取消" : "Cancel" },
          ];

          let selectedModel = await Prompt.askSelect(
            isZh
              ? `当前模型：${activeModel}。请选择要切换的模型：`
              : `Current model: ${activeModel}. Select a model to switch:`,
            createModelOptions(),
          );
          while (selectedModel === "refresh") {
            this.printOutput(
              picocolors.cyan(
                isZh ? "● 正在刷新模型列表…" : "● Refreshing model catalog…",
              ),
            );
            const refreshed = await this.refreshProviderModels(providerId, {
              timeoutMs: 5000,
            });
            this.printOutput(
              refreshed
                ? picocolors.green(
                    isZh ? "✔ 模型列表已刷新。" : "✔ Model catalog refreshed.",
                  )
                : picocolors.yellow(
                    isZh
                      ? "⚠️ 无法刷新模型列表，继续使用缓存列表。"
                      : "⚠️ Model catalog refresh failed; using the cached catalog.",
                  ),
            );
            selectedModel = await Prompt.askSelect(
              isZh
                ? `当前模型：${activeModel}。请选择要切换的模型：`
                : `Current model: ${activeModel}. Select a model to switch:`,
              createModelOptions(),
            );
          }
          if (!selectedModel || selectedModel === "cancel") {
            return { shouldExit: false, processed: true };
          }
          let finalModel = selectedModel;
          if (selectedModel === "auto") {
            if (providerChanged) {
              const switched = await this.switchProvider(
                providerId,
                "__auto__",
                { refreshCatalog: false },
              );
              if (!switched.ok) {
                this.printOutput(picocolors.red(`✖ ${switched.message}`));
                return { shouldExit: false, processed: true };
              }
            } else {
              loop.clearModelOverride();
              this.tui.syncFromLoop(loop);
              this.saveLocalState({
                lastProvider: this.currentProviderId(),
                lastModel: "",
              });
            }
            this.printOutput(
              picocolors.green(
                isZh
                  ? "✔ 已启用自动模型路由。"
                  : "✔ Automatic model routing enabled.",
              ),
            );
            return { shouldExit: false, processed: true };
          } else if (selectedModel === "custom") {
            const customModel = await Prompt.askText(
              isZh ? "请输入自定义模型名称：" : "Enter a custom model name:",
            );
            if (!customModel) {
              return { shouldExit: false, processed: true };
            }
            finalModel = customModel;
          }
          if (providerChanged) {
            const switched = await this.switchProvider(providerId, finalModel, {
              allowUnlistedModel: selectedModel === "custom",
              refreshCatalog: false,
            });
            if (!switched.ok) {
              this.printOutput(picocolors.red(`✖ ${switched.message}`));
              return { shouldExit: false, processed: true };
            }
          } else {
            const violation = validateManagedRuntimeChange(config, {
              model: finalModel,
            });
            if (violation) {
              this.printOutput(picocolors.red(`✖ ${violation}`));
              return { shouldExit: false, processed: true };
            }
            loop.setModelOverride(finalModel);
            this.tui.syncFromLoop(loop);
            this.saveLocalState({
              lastProvider: this.currentProviderId(),
              lastModel: finalModel,
            });
          }
          announceModel(finalModel);
          return { shouldExit: false, processed: true };
        }

        if (["auto", "default", "unlock"].includes(modelArg.toLowerCase())) {
          loop.clearModelOverride();
          this.tui.syncFromLoop(loop);
          this.printOutput(
            picocolors.green(
              isZh
                ? "✔ 已启用自动模型路由。"
                : "✔ Automatic model routing enabled.",
            ),
          );
          this.saveLocalState({
            lastProvider: this.currentProviderId(),
            lastModel: "",
          });
          return { shouldExit: false, processed: true };
        }
        const violation = validateManagedRuntimeChange(config, {
          model: modelArg,
        });
        if (violation) {
          this.printOutput(picocolors.red(`✖ ${violation}`));
          return { shouldExit: false, processed: true };
        }
        loop.setModelOverride(modelArg);
        this.tui.syncFromLoop(loop);
        announceModel(modelArg);
        this.saveLocalState({
          lastProvider: this.currentProviderId(),
          lastModel: modelArg,
        });
        return { shouldExit: false, processed: true };
      }

      if (command === "/commit") {
        const commitMsg = parts.slice(1).join(" ").trim();
        const isZh = config.language !== "en";
        const { execFileSync, execSync } = await import("child_process");
        try {
          let diff = execSync("git diff --cached", {
            ...HIDDEN_CHILD_PROCESS_OPTIONS,
            cwd,
          })
            .toString()
            .trim();
          if (!diff) {
            const unstaged = execSync("git status --porcelain", {
              ...HIDDEN_CHILD_PROCESS_OPTIONS,
              cwd,
            })
              .toString()
              .trim();
            if (!unstaged) {
              this.printOutput(
                picocolors.yellow(
                  isZh
                    ? "工作区干净，没有检测到任何已暂存或未暂存的更改。"
                    : "Workspace clean. No staged or unstaged changes found to commit.",
                ),
              );
              return { shouldExit: false, processed: true };
            }

            const autoStage = await Prompt.askApproval(
              isZh
                ? "未检测到已暂存的修改，是否自动暂存工作区中的所有变更并生成提交？"
                : "No staged changes found. Automatically stage all local changes and create a commit?",
            );

            if (!autoStage) {
              this.printOutput(
                picocolors.yellow(
                  isZh
                    ? "操作已取消。请先运行 'git add' 暂存你的修改。"
                    : "Operation cancelled. Please run 'git add' to stage your changes first.",
                ),
              );
              return { shouldExit: false, processed: true };
            }

            this.printOutput(
              isZh ? "正在暂存所有变更..." : "Staging all changes...",
            );
            execSync("git add -A", {
              ...HIDDEN_CHILD_PROCESS_OPTIONS,
              cwd,
            });
            diff = execSync("git diff --cached", {
              ...HIDDEN_CHILD_PROCESS_OPTIONS,
              cwd,
            })
              .toString()
              .trim();
            if (!diff) {
              this.printOutput(
                picocolors.red(
                  isZh
                    ? "✖ 暂存失败或暂存后仍无变更。"
                    : "✖ Staging failed or resulted in no diff.",
                ),
              );
              return { shouldExit: false, processed: true };
            }
          }

          let finalMsg = commitMsg;
          if (!finalMsg) {
            this.printOutput("Generating commit message via LLM...");
            const fastModel = config.models.fast || config.models.default;
            const stream = this.providerInstance.chat({
              model: fastModel,
              messages: [
                {
                  id: `msg_commit_cmd_${Date.now()}`,
                  role: "user",
                  createdAt: new Date().toISOString(),
                  content: [
                    {
                      type: "text",
                      text: `Generate a concise, high-quality conventional git commit message (e.g. feat(cli): add autocomplete) for the following git diff. Output ONLY the commit message, no formatting, no markdown, no quotes, just the text:\n\n${diff.substring(0, 20000)}`,
                    },
                  ],
                },
              ],
              tools: [],
            });

            let generatedMessage = "";
            for await (const event of stream) {
              if (event.type === "text_delta") {
                generatedMessage += event.text;
              }
            }
            finalMsg = generatedMessage.trim().replace(/^["']|["']$/g, "");
            if (!finalMsg) {
              finalMsg = "chore: auto-commit";
            }
          }

          this.printOutput(
            `Committing changes with message: "${picocolors.green(finalMsg)}"`,
          );
          execFileSync("git", ["commit", "-m", finalMsg], {
            ...HIDDEN_CHILD_PROCESS_OPTIONS,
            cwd,
          });
          this.printOutput(
            picocolors.green("✔ Git commit created successfully."),
          );
        } catch (error: unknown) {
          this.printOutput(
            picocolors.red(
              `✖ Commit failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
        return { shouldExit: false, processed: true };
      }

      if (command === "/chat") {
        return handleSessionCommand(parts[1], parts.slice(2).join(" ").trim(), {
          language: config.language,
          providerId: this.providerInstance.id,
          defaultModel: config.models.default,
          useFullscreenTui,
          loop,
          tui,
          printOutput: (text, raw) => this.printOutput(text, raw),
          saveLocalState: (state) => this.saveLocalState(state),
          refreshCandidates: async () => {
            tui.setCandidates(await getAutocompleteCandidates(cwd, config));
          },
        });
      }

      if (command === "/mode") {
        const isZh = config.language !== "en";
        const targetMode = parts.slice(1).join(" ").trim().toLowerCase();
        const currentMode = loop.getConfig().permissions.mode;

        const modeDescriptions: Record<string, string> = isZh
          ? {
              strict: "Strict  — 所有工具调用必须逐一确认",
              normal: "Normal  — 写入/执行操作需要确认",
              auto: "Full Access — 自动写入、执行与联网；不透明命令仍需确认",
              plan: "Plan    — 规划模式，无实际文件修改",
            }
          : {
              strict: "Strict  — Confirm every tool call before execution",
              normal: "Normal  — Confirm write/exec operations only",
              auto: "Full Access — Auto write, execute, and network; opaque commands still ask",
              plan: "Plan    — Planning mode, no actual file changes",
            };

        if (!targetMode) {
          // No arg: show interactive overlay picker
          if (useFullscreenTui && tui.isActive) {
            const question = isZh
              ? `当前模式: ${picocolors.cyan(currentMode.toUpperCase())}\n\n选择新的安全模式:`
              : `Current mode: ${picocolors.cyan(currentMode.toUpperCase())}\n\nSelect a security mode:`;
            const choice = await Prompt.askSelect(question, [
              { value: "strict", label: modeDescriptions.strict },
              { value: "normal", label: modeDescriptions.normal },
              { value: "auto", label: modeDescriptions.auto },
              { value: "plan", label: modeDescriptions.plan },
            ]);
            if (choice) {
              const result = applyPermissionModePreset(
                loop.getConfig(),
                choice as OrbitConfig["permissions"]["mode"],
              );
              if (!result.ok) {
                this.printOutput(picocolors.red(`✖ ${result.message}`));
                return { shouldExit: false, processed: true };
              }
              this.saveLocalState({
                permissionMode: choice as OrbitConfig["permissions"]["mode"],
              });
              tui.syncFromLoop(loop);
            }
          } else {
            this.printOutput(
              isZh
                ? picocolors.yellow("用法: /mode <strict|normal|auto|plan>")
                : picocolors.yellow("Usage: /mode <strict|normal|auto|plan>"),
            );
          }
          return { shouldExit: false, processed: true };
        }

        const validModes = ["strict", "normal", "auto", "plan"];
        if (!validModes.includes(targetMode)) {
          this.printOutput(
            isZh
              ? picocolors.red(
                  `✖ 无效的安全模式: ${targetMode}。可选模式: ${validModes.join(", ")}`,
                )
              : picocolors.red(
                  `✖ Invalid security mode: ${targetMode}. Valid modes: ${validModes.join(", ")}`,
                ),
          );
          return { shouldExit: false, processed: true };
        }

        const result = applyPermissionModePreset(
          loop.getConfig(),
          targetMode as OrbitConfig["permissions"]["mode"],
        );
        if (!result.ok) {
          this.printOutput(picocolors.red(`✖ ${result.message}`));
          return { shouldExit: false, processed: true };
        }
        this.saveLocalState({
          permissionMode: targetMode as OrbitConfig["permissions"]["mode"],
        });
        tui.syncFromLoop(loop);
        if (useFullscreenTui && tui.isActive) {
          const msg = isZh
            ? `当前模式: ${picocolors.cyan(currentMode.toUpperCase())}\n\n${picocolors.green("✔")} 已切换安全模式至: ${picocolors.green(targetMode.toUpperCase())}`
            : `Previous mode: ${picocolors.cyan(currentMode.toUpperCase())}\n\n${picocolors.green("✔")} Switched security mode to: ${picocolors.green(targetMode.toUpperCase())}`;
          await Prompt.askSelect(msg, [
            { value: "ok", label: isZh ? "返回对话" : "Return to Chat" },
          ]);
        } else {
          this.printOutput(
            isZh
              ? picocolors.green(
                  `✔ 已切换安全模式至: ${targetMode.toUpperCase()}`,
                )
              : picocolors.green(
                  `✔ Switched security mode to: ${targetMode.toUpperCase()}`,
                ),
          );
        }
        return { shouldExit: false, processed: true };
      }

      if (command === "/copy") {
        const isZh = config.language !== "en";
        const history = loop.getHistory();
        const lastAssistantMsg = [...history]
          .reverse()
          .find((msg) => msg.role === "assistant");

        if (!lastAssistantMsg) {
          this.printOutput(
            isZh
              ? picocolors.yellow("没有找到 AI 的最近回复。")
              : picocolors.yellow(
                  "No recent assistant response found to copy.",
                ),
          );
          return { shouldExit: false, processed: true };
        }

        let textToCopy = "";
        if (typeof lastAssistantMsg.content === "string") {
          textToCopy = lastAssistantMsg.content;
        } else if (Array.isArray(lastAssistantMsg.content)) {
          textToCopy = lastAssistantMsg.content
            .map((content) => (content.type === "text" ? content.text : ""))
            .join("");
        }

        if (!textToCopy) {
          this.printOutput(
            isZh
              ? picocolors.yellow("AI 的最近回复内容为空。")
              : picocolors.yellow("Recent assistant response is empty."),
          );
          return { shouldExit: false, processed: true };
        }

        const copied = this.copyToClipboard(textToCopy);
        if (copied) {
          this.printOutput(
            isZh
              ? picocolors.green("✔ 已成功复制 AI 最近回复到剪贴板！")
              : picocolors.green(
                  "✔ Successfully copied recent AI response to clipboard!",
                ),
          );
        } else {
          this.printOutput(
            isZh
              ? picocolors.red(
                  "✖ 复制到剪贴板失败，系统未配置剪贴板工具（如 pbcopy/clip/xclip）。",
                )
              : picocolors.red(
                  "✖ Failed to copy to clipboard. Ensure pbcopy/clip/xclip is installed.",
                ),
          );
        }
        return { shouldExit: false, processed: true };
      }

      this.printOutput(
        picocolors.red(
          `Unknown command: ${trimmed}. Type /help for available commands.`,
        ),
      );
      return { shouldExit: false, processed: true };
    }

    return { shouldExit: false, processed: false, input: trimmed };
  }

  private async submitWebPrompt(
    prompt: string,
    attachments: WebUiImageAttachment[] = [],
    executionMode: "default" | "single" | "multi" = "default",
  ): Promise<{ ok: boolean; message?: string }> {
    const trimmed = prompt.trim();
    const useMulti =
      executionMode === "multi" || (executionMode === "default" && this.multi);
    if (!trimmed) {
      return { ok: false, message: "Prompt is empty." };
    }
    if (this.tui.hasActiveRunnable()) {
      return {
        ok: false,
        message: "Orbit is already processing a Web UI request.",
      };
    }
    if (attachments.length > 0) {
      if (useMulti) {
        return {
          ok: false,
          message:
            "Image attachments are not yet supported in multi-agent mode.",
        };
      }
      const model = this.loop.getModelOverride() || this.config.models.default;
      const capabilities =
        this.providerInstance.getModelCapabilities?.(model) ||
        this.providerInstance.capabilities;
      if (!capabilities.vision) {
        return {
          ok: false,
          message: `The selected model (${model}) does not support image input. Switch to a vision-capable model or remove the attachment.`,
        };
      }
    }

    const releaseRun = this.runCoordinator.acquire("web");
    if (!releaseRun) {
      return {
        ok: false,
        message: "Orbit is already processing another request.",
      };
    }
    try {
      const routeResult = await this.route(trimmed);
      if (routeResult.processed) {
        return { ok: true };
      }
      const routedPrompt = routeResult.input ?? trimmed;

      if (this.tui.isActive) {
        this.tui.addUserMessage(trimmed);
      } else {
        console.log(picocolors.cyan(`web › ${trimmed}`));
      }
      this.loop.prepareUserTurn(
        routedPrompt,
        attachments.map((attachment) => ({
          type: "image" as const,
          mediaType: attachment.mediaType,
          data: attachment.data,
          name: attachment.name,
        })),
      );
      ensureSessionTitle(this.loop, trimmed);
      this.saveLocalState({
        lastSessionId: this.loop.getSessionId(),
        lastProvider: this.currentProviderId(),
        lastModel: this.loop.getModelOverride() || this.config.models.default,
      });

      const webInteraction = this.createWebUiInteraction();
      this.loop.setUserInteraction(webInteraction);

      let runnable: AgentLoop | Orchestrator = this.loop;
      if (useMulti) {
        runnable = new Orchestrator(
          this.cwd,
          this.config,
          this.providerInstance,
          routedPrompt,
          webInteraction,
        );
      }

      this.tui.setActiveRunnable(runnable);
      this.webUiRunnable = runnable;
      let outcome: AgentLoopRunOutcome | undefined;
      try {
        outcome = await runnable.run();
      } finally {
        this.webApprovalBroker.cancel();
        this.loop.setUserInteraction(this.tuiInteraction);
        if (this.webUiRunnable === runnable) this.webUiRunnable = null;
        this.tui.setActiveRunnable(null);
        this.tui.syncFromLoop(this.loop);
        this.tui.finishAttempt();
      }
      if (!outcome) {
        throw new Error("Orbit did not produce a run outcome.");
      }
      while (outcome.status === "completed") {
        if (typeof this.loop.takeNextQueuedInput !== "function") break;
        const queuedInput = this.loop.takeNextQueuedInput();
        if (!queuedInput) break;
        this.loop.prepareQueuedUserTurn(queuedInput);
        ensureSessionTitle(this.loop, queuedInput.text);
        if (this.tui.isActive) {
          this.tui.addUserMessage(queuedInput.text);
        }
        const queuedInteraction = this.createWebUiInteraction();
        this.loop.setUserInteraction(queuedInteraction);
        const queuedRunnable: AgentLoop | Orchestrator = useMulti
          ? new Orchestrator(
              this.cwd,
              this.config,
              this.providerInstance,
              queuedInput.text,
              queuedInteraction,
            )
          : this.loop;
        const turnId = randomUUID();
        eventBus.emitEvent("ui_turn_started", {
          turnId,
          source: "web",
          prompt: queuedInput.text,
        });
        this.tui.setActiveRunnable(queuedRunnable);
        this.webUiRunnable = queuedRunnable;
        try {
          outcome = await queuedRunnable.run();
        } finally {
          this.webApprovalBroker.cancel();
          this.loop.setUserInteraction(this.tuiInteraction);
          if (this.webUiRunnable === queuedRunnable) this.webUiRunnable = null;
          this.tui.setActiveRunnable(null);
          this.tui.syncFromLoop(this.loop);
          this.tui.finishAttempt();
          eventBus.emitEvent("ui_turn_completed", {
            turnId,
            source: "web",
            status: outcome?.status || "failed",
            message: getRunOutcomeMessage(outcome),
          });
        }
        if (!outcome) {
          throw new Error("Orbit did not produce a queued-turn outcome.");
        }
      }
      if (outcome.status === "failed") {
        return { ok: false, message: outcome.error.message };
      }
      if (outcome.status === "aborted") {
        return { ok: false, message: outcome.message };
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
    } finally {
      releaseRun();
    }
  }

  /** Start one persisted child session without blocking the control request. */
  private resumeWebUiAgent(
    runId: string,
    agentId: string,
  ): { ok: boolean; message?: string } {
    if (this.tui.hasActiveRunnable()) {
      return {
        ok: false,
        message: "Orbit is already processing another request.",
      };
    }

    const store = new AgentRunStore(this.cwd);
    try {
      store.initialize();
      store.recoverInterruptedRuns();
      const run = store.getRun(runId);
      const agent = run?.agents.find((candidate) => candidate.id === agentId);
      if (!run || !agent) {
        return { ok: false, message: "The persisted agent was not found." };
      }
      if (!agent.sessionId) {
        return {
          ok: false,
          message: "This agent has no persisted session to resume.",
        };
      }
      if (agent.status === "completed") {
        return {
          ok: false,
          message: "This agent already completed successfully.",
        };
      }
      const persistedSession = new SessionManager(
        this.cwd,
        ORCHESTRATED_AGENT_SESSION_PATH,
      )
        .getSessionStore()
        .getSession(agent.sessionId);
      if (!persistedSession) {
        return {
          ok: false,
          message: "The persisted child session is missing or unreadable.",
        };
      }
      if (persistedSession.provider !== this.providerInstance.id) {
        return {
          ok: false,
          message: `Switch to provider ${persistedSession.provider} before resuming this agent.`,
        };
      }

      const releaseRun = this.runCoordinator.acquire("web");
      if (!releaseRun) {
        return {
          ok: false,
          message: "Orbit is already processing another request.",
        };
      }

      const resumePrompt = [
        `Resume the interrupted ${agent.role} task: ${agent.task}`,
        "Inspect the current workspace state before continuing because the previous isolated execution may have ended unexpectedly.",
        "Continue only the original delegated task, respect the stored access mode and scopes, verify your result, and do not commit or merge.",
      ].join("\n\n");
      const readTools = [
        "read_file",
        "list_files",
        "glob",
        "grep",
        "git_status",
        "git_diff",
        "detect_project",
        "inspect_project",
      ];
      const writeTools = [
        "read_file",
        "write_file",
        "edit_file",
        "list_files",
        "glob",
        "grep",
        "git_status",
        "git_diff",
      ];
      let child: AgentLoop | undefined;
      try {
        child = AgentLoop.initialize(
          this.cwd,
          this.config,
          this.providerInstance,
          resumePrompt,
          this.createWebUiInteraction(),
          {
            modelOverride: agent.model,
            systemPromptOverride: `You are a resumed Orbit ${agent.role} agent. Continue the original delegated task from its persisted session. Your access mode is ${agent.access.mode}; your logical scopes are ${agent.access.scopes.join(", ")}. Inspect current state before acting, stay within those boundaries, and do not commit or merge.`,
            allowedTools:
              agent.access.mode === "write" ? writeTools : readTools,
            disableMcp: true,
            sessionId: agent.sessionId,
            requireSession: true,
            agent: { id: agent.id, role: agent.role },
            sessionStorage: {
              workspaceRoot: this.cwd,
              path: ORCHESTRATED_AGENT_SESSION_PATH,
            },
          },
        );
        child.prepareUserTurn(resumePrompt);
        store.resumeAgent(runId, agentId);
      } catch (error: unknown) {
        if (child) void child.dispose();
        releaseRun();
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (!child) {
        releaseRun();
        return { ok: false, message: "Orbit could not initialize the agent." };
      }

      this.tui.setActiveRunnable(child);
      this.webUiRunnable = child;
      this.webUiResumedAgentId = agentId;
      eventBus.emitEvent("agent_spawn", {
        parentId: runId,
        childId: agentId,
        role: agent.role,
        task: resumePrompt,
      });
      void this.runResumedWebUiAgent(store, runId, agentId, child, releaseRun);
      return { ok: true, message: "Persisted agent resume started." };
    } catch (error: unknown) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Persist and broadcast the complete lifecycle of a resumed child. */
  private async runResumedWebUiAgent(
    store: AgentRunStore,
    runId: string,
    agentId: string,
    child: AgentLoop,
    releaseRun: () => void,
  ): Promise<void> {
    let stopLeaseHeartbeat = (): void => undefined;
    try {
      stopLeaseHeartbeat = store.startLeaseHeartbeat(runId);
      const outcome = await child.run();
      const status =
        outcome.status === "completed"
          ? "completed"
          : outcome.status === "aborted"
            ? "aborted"
            : "failed";
      store.updateAgent(runId, agentId, {
        status,
        costUsd: child.getSessionCost(),
        endedAt: new Date().toISOString(),
        error: getRunOutcomeMessage(outcome),
      });
      store.finishRun(runId, status);
      eventBus.emitEvent("agent_completed", {
        taskId: agentId,
        success: status === "completed",
        status,
        ...(status === "completed"
          ? {}
          : {
              error: getRunOutcomeMessage(outcome) || "Agent did not complete.",
            }),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        store.updateAgent(runId, agentId, {
          status: "failed",
          costUsd: child.getSessionCost(),
          endedAt: new Date().toISOString(),
          error: message,
        });
        store.finishRun(runId, "failed");
      } catch {
        // The live failure is still surfaced through the central event stream.
      }
      eventBus.emitEvent("agent_completed", {
        taskId: agentId,
        success: false,
        status: "failed",
        error: message,
      });
    } finally {
      stopLeaseHeartbeat();
      try {
        await child.dispose();
      } catch (error: unknown) {
        eventBus.emitEvent("warning", {
          message: `Failed to dispose resumed agent ${agentId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } finally {
        this.webApprovalBroker.cancel();
        if (this.webUiRunnable === child) this.webUiRunnable = null;
        if (this.webUiResumedAgentId === agentId) {
          this.webUiResumedAgentId = null;
        }
        this.tui.setActiveRunnable(null);
        this.tui.syncFromLoop(this.loop);
        this.tui.finishAttempt();
        releaseRun();
      }
    }
  }

  private updateWebUiInputQueue(action: WebUiInputQueueAction): {
    ok: boolean;
    message?: string;
  } {
    if (action.action === "remove") {
      return this.loop.removeQueuedInput(action.inputId)
        ? { ok: true }
        : { ok: false, message: "Queued message was not found." };
    }
    if (action.action === "clear") {
      const removed = this.loop.clearQueuedInputs();
      return { ok: true, message: `${removed} queued message(s) cleared.` };
    }
    if (action.action === "move") {
      return this.loop.moveQueuedInput(action.inputId, action.direction)
        ? { ok: true }
        : {
            ok: false,
            message: "Queued message cannot move farther in that direction.",
          };
    }
    const orchestrated =
      this.webUiRunnable instanceof Orchestrator ||
      (this.multi && this.runCoordinator.isActive("terminal"));
    if (action.action === "update") {
      if (action.mode === "steer" && !this.tui.hasActiveRunnable()) {
        return {
          ok: false,
          message: "Steering requires a currently active task.",
        };
      }
      if (action.mode === "steer" && orchestrated) {
        return {
          ok: false,
          message:
            "Multi-agent runs accept ordered follow-ups instead of mid-turn steering.",
        };
      }
      return this.loop.updateQueuedInput(action.inputId, {
        ...(action.prompt !== undefined ? { text: action.prompt } : {}),
        ...(action.mode !== undefined ? { mode: action.mode } : {}),
      })
        ? { ok: true, message: "Queued message updated." }
        : { ok: false, message: "Queued message was not found." };
    }
    if (!this.tui.hasActiveRunnable()) {
      return {
        ok: false,
        message: "Send the message normally because Orbit is currently idle.",
      };
    }
    if (orchestrated && action.attachments.length > 0) {
      return {
        ok: false,
        message: "Image follow-ups are not supported during multi-agent runs.",
      };
    }
    if (action.attachments.length > 0) {
      const model = this.loop.getModelOverride() || this.config.models.default;
      const capabilities =
        this.providerInstance.getModelCapabilities?.(model) ||
        this.providerInstance.capabilities;
      if (!capabilities.vision) {
        return {
          ok: false,
          message: `The selected model (${model}) does not support image input.`,
        };
      }
    }
    const mode = orchestrated ? "follow_up" : action.mode;
    this.loop.enqueueUserInput(action.prompt, {
      mode,
      source: "web",
      attachments: action.attachments.map((attachment) => ({
        type: "image" as const,
        mediaType: attachment.mediaType,
        data: attachment.data,
        name: attachment.name,
      })),
    });
    return {
      ok: true,
      message:
        mode === "steer"
          ? "Steering instruction accepted."
          : "Follow-up added to the shared queue.",
    };
  }

  private startWebUiTask(
    action: WebUiTaskAction,
  ): Promise<{ ok: boolean; message?: string }> {
    const isEnglish = this.config.language === "en";
    const isTraditional = this.config.language === "zh-TW";
    if (action.action === "plan") {
      const prompt = isEnglish
        ? "Planning only: review the current chat goal and workspace context, then create or update a concise, recoverable execution plan with clear verification steps. Do not modify files or run write-capable tools; return after the plan is ready."
        : isTraditional
          ? "僅進行規劃：審視目前對話目標與工作區脈絡，建立或更新一份精簡、可恢復並包含明確驗證步驟的執行計畫。不要修改檔案或執行具寫入能力的工具；計畫完成後直接返回。"
          : "仅进行规划：审视当前对话目标与工作区上下文，创建或更新一份简洁、可恢复并包含明确验证步骤的执行计划。不要修改文件或运行具备写入能力的工具；计划完成后直接返回。";
      return this.submitWebPrompt(prompt, [], "single");
    }
    const prompt = isEnglish
      ? "Improve the current workspace with the highest-impact changes justified by the current chat goal. Use the isolated multi-agent planner, coder, and reviewer flow; verify the result and merge only reviewed changes. Preserve unrelated user work."
      : isTraditional
        ? "依照目前對話目標，對工作區進行影響最大的改進。使用隔離的多智慧體規劃、實作與審查流程，驗證結果且只合併通過審查的變更，並保留不相關的使用者工作。"
        : "根据当前对话目标，对工作区进行影响最大的改进。使用隔离的多智能体规划、实现与审查流程，验证结果且只合并通过审查的变更，并保留不相关的用户工作。";
    return this.submitWebPrompt(prompt, [], "multi");
  }

  private cancelWebPrompt(): { ok: boolean; message?: string } {
    if (this.runCoordinator.isActive("web") && this.webUiRunnable) {
      this.webApprovalBroker.cancel();
      this.webUiRunnable.abort("immediate");
      return { ok: true };
    }
    if (
      this.runCoordinator.isActive("terminal") &&
      this.tui.abortActiveRunnable("immediate")
    ) {
      return { ok: true };
    }
    return { ok: false, message: "Nothing is currently running." };
  }

  private createWebUiInteraction(): UserInteraction {
    const isZh = this.config.language !== "en";
    return {
      askApproval: (reason, preview) =>
        this.webApprovalBroker.request({
          kind: "action",
          title: isZh ? "需要确认操作" : "Confirm this action",
          reason,
          preview,
        }),
      askToolApproval: ({
        toolCallId,
        toolName,
        reason,
        preview,
        agentId,
        agentRole,
      }) =>
        this.webApprovalBroker.request({
          kind: "tool",
          title: isZh
            ? `允许 Orbit 使用 ${toolName}？`
            : `Allow Orbit to use ${toolName}?`,
          reason,
          preview,
          toolCallId,
          agentId,
          agentRole,
        }),
      reviewFileChange: ({ filePath, before, after, agentId, agentRole }) =>
        this.webApprovalBroker.request({
          kind: "change",
          title: isZh
            ? `接受对 ${filePath} 的修改？`
            : `Accept changes to ${filePath}?`,
          reason: isZh
            ? "请检查下面的差异，再决定保留或回滚这次修改。"
            : "Review the diff before keeping or rolling back this change.",
          preview: DiffView.renderPlain(filePath, before, after),
          agentId,
          agentRole,
        }),
      showText: (text) => this.tuiInteraction.showText(text),
      showDiff: (filePath, before, after) => {
        eventBus.emitEvent("file_diff", {
          filePath,
          diff: DiffView.renderPlain(filePath, before, after),
        });
      },
    };
  }

  private async updateWebUiSettings(
    patch: WebUiSettingsPatch,
  ): Promise<{ ok: boolean; message?: string }> {
    if (this.runCoordinator.isActive() || this.tui.hasActiveRunnable()) {
      return {
        ok: false,
        message: "Wait for the active task to finish before changing settings.",
      };
    }
    const changesProvider =
      Boolean(patch.provider) && patch.provider !== this.providerInstance.id;
    if (patch.model && patch.model !== "__auto__" && !changesProvider) {
      const providerId = this.config.provider.default;
      const availableModels = getProviderModelCandidates(
        this.config,
        providerId,
      );
      const currentOverride = this.loop.getModelOverride();
      const allowExistingUnlisted =
        !isOfficialDeepSeekProvider(this.config, providerId) &&
        patch.model === currentOverride;
      if (!availableModels.includes(patch.model) && !allowExistingUnlisted) {
        return {
          ok: false,
          message: `Model is not available for provider ${providerId}: ${patch.model}`,
        };
      }
    }
    const violation = validateManagedRuntimeChange(this.config, patch);
    if (violation) return { ok: false, message: violation };
    const draft = JSON.parse(JSON.stringify(this.config));
    if (patch.language) {
      draft.language = patch.language;
    }
    if (patch.provider) {
      draft.provider.default = patch.provider;
    }
    if (patch.permissionMode) {
      const preset = applyPermissionModePreset(draft, patch.permissionMode);
      if (!preset.ok) return preset;
    }
    if (typeof patch.webSearchEnabled === "boolean") {
      draft.tools.webSearch.enabled = patch.webSearchEnabled;
    }
    if (patch.webSearchProvider) {
      draft.tools.webSearch.provider = patch.webSearchProvider;
    }
    if (typeof patch.webSearchMaxResults === "number") {
      draft.tools.webSearch.maxResults = patch.webSearchMaxResults;
    }
    if (typeof patch.skillsEnabled === "boolean") {
      draft.skills.enabled = patch.skillsEnabled;
    }
    if (patch.skillsActivation) {
      draft.skills.activation = patch.skillsActivation;
    }
    if (typeof patch.skillsMaxActive === "number") {
      draft.skills.maxActive = patch.skillsMaxActive;
    }
    if (patch.skillsDisabled) {
      draft.skills.disabled = patch.skillsDisabled;
    }

    const parsed = ConfigSchema.safeParse(draft);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.message };
    }

    const providerChanged =
      Boolean(patch.provider) && patch.provider !== this.providerInstance.id;
    if (patch.provider && providerChanged) {
      const switched = await this.switchProvider(patch.provider, patch.model);
      if (!switched.ok) return switched;
    }
    if (patch.model && !providerChanged) {
      if (patch.model === "__auto__") {
        this.loop.clearModelOverride();
        this.saveLocalState({
          lastProvider: this.currentProviderId(),
          lastModel: "",
        });
      } else {
        this.loop.setModelOverride(patch.model);
        this.saveLocalState({
          lastProvider: this.currentProviderId(),
          lastModel: patch.model,
        });
      }
    }
    if (patch.language) {
      this.config.language = patch.language;
      this.saveLocalState({ language: patch.language });
    }
    if (patch.permissionMode) {
      const preset = applyPermissionModePreset(
        this.config,
        patch.permissionMode,
      );
      if (!preset.ok) return preset;
      this.tui.setPermissionsMode(patch.permissionMode);
      this.saveLocalState({ permissionMode: patch.permissionMode });
    }
    if (typeof patch.webSearchEnabled === "boolean") {
      this.config.tools.webSearch.enabled = patch.webSearchEnabled;
    }
    if (patch.webSearchProvider) {
      this.config.tools.webSearch.provider = patch.webSearchProvider;
    }
    if (typeof patch.webSearchMaxResults === "number") {
      this.config.tools.webSearch.maxResults = patch.webSearchMaxResults;
    }
    const skillsChanged =
      typeof patch.skillsEnabled === "boolean" ||
      patch.skillsActivation !== undefined ||
      typeof patch.skillsMaxActive === "number" ||
      patch.skillsDisabled !== undefined;
    if (typeof patch.skillsEnabled === "boolean") {
      this.config.skills.enabled = patch.skillsEnabled;
    }
    if (patch.skillsActivation) {
      this.config.skills.activation = patch.skillsActivation;
    }
    if (typeof patch.skillsMaxActive === "number") {
      this.config.skills.maxActive = patch.skillsMaxActive;
    }
    if (patch.skillsDisabled) {
      this.config.skills.disabled = [...patch.skillsDisabled];
    }
    if (skillsChanged) {
      // Persist so a disabled skill stays disabled across restarts.
      this.saveLocalState({
        skills: {
          enabled: this.config.skills.enabled,
          activation: this.config.skills.activation,
          maxActive: this.config.skills.maxActive,
          disabled: [...this.config.skills.disabled],
        },
      });
      this.loop.invalidateSkillsCache();
    }

    return { ok: true };
  }

  private async refreshProviderModels(
    providerId: string,
    options: { timeoutMs?: number } = {},
  ): Promise<boolean> {
    const provider = this.config.providers[providerId];
    if (
      !provider?.baseUrl ||
      (provider.type !== "openai" &&
        provider.type !== "openai-compatible" &&
        provider.type !== "ollama")
    ) {
      return false;
    }
    try {
      const discovered = await discoverProviderModels({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        ...(provider.type === "ollama" ? { providerType: "ollama" } : {}),
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
      });
      provider.baseUrl = discovered.baseUrl;
      provider.models = discovered.models;
      provider.modelCapabilities = {
        ...(provider.modelCapabilities || {}),
        ...discovered.modelCapabilities,
      };
      return true;
    } catch {
      // A cached configured catalog remains usable when a provider blocks or
      // temporarily fails its model-list endpoint.
      return false;
    }
  }

  private async switchProvider(
    providerId: string,
    preferredModel?: string,
    options: {
      allowUnlistedModel?: boolean;
      refreshCatalog?: boolean;
    } = {},
  ): Promise<{ ok: boolean; message?: string }> {
    const policyViolation = validateManagedRuntimeChange(this.config, {
      provider: providerId,
      model:
        preferredModel && preferredModel !== "__auto__"
          ? preferredModel
          : undefined,
    });
    if (policyViolation) return { ok: false, message: policyViolation };
    if (!this.config.providers[providerId]) {
      return { ok: false, message: `Provider not found: ${providerId}` };
    }
    if (options.refreshCatalog !== false) {
      await this.refreshProviderModels(providerId);
    }
    const previousProviderId = this.config.provider.default;
    const previousProviderInstance = this.providerInstance;
    const previousModelOverride = this.loop.getModelOverride();
    try {
      const provider = createProviderFromConfig({
        ...this.config,
        provider: { ...this.config.provider, default: providerId },
      });
      await provider.initialize?.();
      const models = getProviderModelCandidates(this.config, providerId);
      const currentModel = previousModelOverride || this.config.models.default;
      const cleanPreferredModel = preferredModel?.trim();
      const automaticRouting = cleanPreferredModel === "__auto__";
      const nextModel =
        cleanPreferredModel &&
        !automaticRouting &&
        (options.allowUnlistedModel || models.includes(cleanPreferredModel))
          ? cleanPreferredModel
          : models.includes(currentModel)
            ? currentModel
            : models.includes(this.config.models.default)
              ? this.config.models.default
              : models.find((model) => model.includes("deepseek-v4-flash")) ||
                models[0];
      this.config.provider.default = providerId;
      this.providerInstance = provider;
      this.setProviderInstance(provider);
      this.loop.setProvider(provider);
      let persistedModel = "";
      if (automaticRouting || !nextModel) {
        this.loop.clearModelOverride();
      } else {
        this.loop.setModelOverride(nextModel);
        persistedModel = nextModel;
      }
      this.tui.syncFromLoop(this.loop);
      this.saveLocalState({
        lastProvider: providerId,
        lastModel: persistedModel,
      });
      return { ok: true };
    } catch (error: unknown) {
      this.config.provider.default = previousProviderId;
      if (this.providerInstance !== previousProviderInstance) {
        this.providerInstance = previousProviderInstance;
        try {
          this.setProviderInstance(previousProviderInstance);
          this.loop.setProvider(previousProviderInstance);
          if (previousModelOverride) {
            this.loop.setModelOverride(previousModelOverride);
          } else {
            this.loop.clearModelOverride();
          }
          this.tui.syncFromLoop(this.loop);
        } catch {
          // Preserve the original provider-switch failure for the caller.
        }
      }
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Provider switch failed.",
      };
    }
  }

  private async updateWebUiSession(
    action: WebUiSessionAction,
  ): Promise<{ ok: boolean; message?: string }> {
    if (this.tui.hasActiveRunnable()) {
      return { ok: false, message: "Orbit is already processing a request." };
    }
    const releaseRun = this.runCoordinator.acquire("web");
    if (!releaseRun) {
      return {
        ok: false,
        message: "Orbit is already processing another request.",
      };
    }
    try {
      if (action.action === "new") {
        const model =
          this.loop.getModelOverride() || this.config.models.default;
        const sessionId = this.loop.startNewSession(
          this.providerInstance.id,
          model,
        );
        this.tui.loadHistory([]);
        this.saveLocalState({
          lastSessionId: sessionId,
          lastProvider: this.currentProviderId(),
          lastModel: model,
        });
        this.printOutput(`✔ Started new session: ${sessionId}`);
      } else if (action.action === "resume") {
        if (!this.loop.resumeSession(action.sessionId)) {
          return {
            ok: false,
            message: `Session not found: ${action.sessionId}`,
          };
        }
        this.tui.loadHistory(this.loop.getHistory());
        this.saveLocalState({
          lastSessionId: action.sessionId,
          lastProvider: this.currentProviderId(),
          lastModel: this.loop.getModelOverride() || this.config.models.default,
        });
        this.printOutput(`✔ Switched to session: ${action.sessionId}`);
      } else {
        const activeSessionId = this.loop.getSessionId();
        if (activeSessionId === action.sessionId) {
          return {
            ok: false,
            message: "The active session cannot be archived or deleted.",
          };
        }
        if (action.action === "delete") {
          const exists = this.loop
            .getSessions()
            .some((session) => session.id === action.sessionId);
          if (!exists) {
            return {
              ok: false,
              message: `Session not found: ${action.sessionId}`,
            };
          }
          this.loop.deleteSession(action.sessionId);
          this.printOutput(`✔ Deleted session: ${action.sessionId}`);
        } else {
          const archived = action.action === "archive";
          if (!this.loop.setSessionArchived(action.sessionId, archived)) {
            return {
              ok: false,
              message: `Session not found: ${action.sessionId}`,
            };
          }
          this.printOutput(
            `✔ ${archived ? "Archived" : "Restored"} session: ${action.sessionId}`,
          );
        }
      }
      this.tui.syncFromLoop(this.loop);
      const cachedCandidates = this.getCandidates();
      this.tui.setCandidates(
        cachedCandidates ||
          (await getAutocompleteCandidates(this.cwd, this.config)),
      );
      return { ok: true };
    } catch (error: unknown) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      releaseRun();
    }
  }

  private copyToClipboard(text: string): boolean {
    const { execSync } = require("child_process");
    try {
      if (process.platform === "win32") {
        execSync("clip", {
          ...HIDDEN_CHILD_PROCESS_OPTIONS,
          input: text,
        });
        return true;
      } else if (process.platform === "darwin") {
        execSync("pbcopy", {
          ...HIDDEN_CHILD_PROCESS_OPTIONS,
          input: text,
        });
        return true;
      } else {
        try {
          execSync("xclip -selection clipboard", {
            ...HIDDEN_CHILD_PROCESS_OPTIONS,
            input: text,
          });
          return true;
        } catch {
          try {
            execSync("xsel -ib", {
              ...HIDDEN_CHILD_PROCESS_OPTIONS,
              input: text,
            });
            return true;
          } catch {
            try {
              execSync("wl-copy", {
                ...HIDDEN_CHILD_PROCESS_OPTIONS,
                input: text,
              });
              return true;
            } catch {
              return false;
            }
          }
        }
      }
    } catch {
      return false;
    }
  }
}
