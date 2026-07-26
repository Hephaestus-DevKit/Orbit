import type { OrbitConfig } from "@orbit-build/config";
import { PermissionEngine } from "@orbit-build/permissions";
import { Prompt } from "@orbit-build/tui";
import picocolors from "picocolors";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";
import {
  HANDLED_COMMAND,
  type CommandHandlerResult,
} from "./CommandHandlerTypes.js";

interface ShellTui {
  isActive: boolean;
  stop(): void;
  start(budgetLimit: number): void;
  syncFromLoop(loop: unknown): void;
}

interface ShellPromptAdapter {
  askApproval(question: string): Promise<boolean>;
  askText(question: string): Promise<string | null>;
}

interface ShellExecutionResult {
  status: number | null;
}

export interface ShellCommandDependencies {
  cwd: string;
  config: OrbitConfig;
  loop: unknown;
  tui: ShellTui;
  useFullscreenTui: boolean;
  prompt?: ShellPromptAdapter;
  execute?: (command: string, cwd: string) => Promise<ShellExecutionResult>;
  writeLine?: (text: string) => void;
}

function parseShellCommand(input: string): string | null {
  if (input.startsWith("!")) return input.slice(1).trim();
  if (input === "/run" || input.startsWith("/run ")) {
    return input.slice(4).trim();
  }
  return null;
}

async function executeWithSystemShell(
  command: string,
  cwd: string,
): Promise<ShellExecutionResult> {
  const { spawnSync } = await import("child_process");
  // shell:true is intentional: the command was explicitly entered by the user
  // and has already passed through PermissionEngine.
  return spawnSync(command, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    cwd,
    stdio: "inherit",
    shell: true,
  });
}

/** Handles `!command` and `/run command`, or returns null for other input. */
export async function handleShellCommand(
  input: string,
  dependencies: ShellCommandDependencies,
): Promise<CommandHandlerResult | null> {
  const shellCommand = parseShellCommand(input);
  if (shellCommand === null) return null;

  const {
    config,
    cwd,
    loop,
    tui,
    useFullscreenTui,
    prompt = Prompt,
    execute = executeWithSystemShell,
    writeLine = console.log,
  } = dependencies;
  const wasActive = useFullscreenTui && tui.isActive;
  if (wasActive) tui.stop();

  const isZh = config.language !== "en";
  if (!shellCommand) {
    writeLine(
      isZh
        ? picocolors.yellow("用法: !<shell_command> 或 /run <shell_command>")
        : picocolors.yellow("Usage: !<shell_command> or /run <shell_command>"),
    );
    if (wasActive) tui.start(config.budgetLimit);
    return HANDLED_COMMAND;
  }

  const decision = new PermissionEngine(config, cwd).evaluate(
    "bash",
    { command: shellCommand },
    "execute",
  );
  if (decision.action === "deny") {
    writeLine(
      picocolors.red(
        isZh
          ? `✖ 命令已被安全策略阻止: ${decision.reason}`
          : `✖ Command blocked by safety policy: ${decision.reason}`,
      ),
    );
    if (wasActive) tui.start(config.budgetLimit);
    return HANDLED_COMMAND;
  }

  if (decision.action === "ask") {
    const approved = await prompt.askApproval(
      isZh
        ? `命令需要 ${decision.risk} 权限：${shellCommand}`
        : `Command requires ${decision.risk} permission: ${shellCommand}`,
    );
    if (!approved) {
      writeLine(isZh ? "已取消命令执行。" : "Command execution cancelled.");
      if (wasActive) tui.start(config.budgetLimit);
      return HANDLED_COMMAND;
    }
  }

  writeLine(
    isZh
      ? picocolors.cyan(`\n正在执行 Shell 命令: ${shellCommand}...`)
      : picocolors.cyan(`\nRunning shell command: ${shellCommand}...`),
  );

  try {
    const result = await execute(shellCommand, cwd);
    writeLine(
      result.status === 0
        ? isZh
          ? picocolors.green("\n✔ 命令执行成功。")
          : picocolors.green("\n✔ Command completed successfully.")
        : isZh
          ? picocolors.red(`\n✖ 命令执行失败，退出代码: ${result.status}`)
          : picocolors.red(
              `\n✖ Command failed with exit code ${result.status}`,
            ),
    );
    await prompt.askText(
      isZh ? "按 Enter 键返回 Orbit..." : "Press Enter to return to Orbit...",
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    writeLine(
      isZh
        ? picocolors.red(`无法执行命令: ${message}`)
        : picocolors.red(`Failed to execute command: ${message}`),
    );
  } finally {
    tui.syncFromLoop(loop);
    if (wasActive) tui.start(config.budgetLimit);
  }
  return HANDLED_COMMAND;
}
