import { ConfigSchema, type OrbitConfig } from "@orbit-build/config";
import { Prompt, type PromptOption } from "@orbit-build/tui";
import picocolors from "picocolors";
import { getNestedProperty, setNestedProperty } from "../ConfigObjectPath.js";
import {
  HANDLED_COMMAND,
  type CommandHandlerResult,
  type CommandOutput,
} from "./CommandHandlerTypes.js";

interface ConfigPromptAdapter {
  askSelect(question: string, options: PromptOption[]): Promise<string | null>;
  askText(question: string, defaultValue?: string): Promise<string | null>;
}

export interface WorkspaceConfigDependencies {
  getConfig(): OrbitConfig;
  printOutput: CommandOutput;
  prompt?: ConfigPromptAdapter;
}

type ParsedConfigValue = { ok: true; value: unknown } | { ok: false; message: string };

function parseConfigValue(
  key: string,
  currentValue: unknown,
  rawValue: string,
): ParsedConfigValue {
  if (typeof currentValue === "boolean") {
    const normalized = rawValue.toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return { ok: true, value: true };
    }
    if (normalized === "false" || normalized === "0") {
      return { ok: true, value: false };
    }
    return {
      ok: false,
      message: `Error: Key "${key}" expects a boolean value (true/false).`,
    };
  }
  if (typeof currentValue === "number") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed)
      ? { ok: true, value: parsed }
      : {
        ok: false,
        message: `Error: Key "${key}" expects a numeric value.`,
      };
  }
  if (Array.isArray(currentValue)) {
    return {
      ok: true,
      value: rawValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    };
  }
  return { ok: true, value: rawValue };
}

function validateAndApply(
  config: OrbitConfig,
  key: string,
  value: unknown,
): string | null {
  const draft = structuredClone(config) as Record<string, unknown>;
  setNestedProperty(draft, key, value);
  const result = ConfigSchema.safeParse(draft);
  if (!result.success) return result.error.message;
  setNestedProperty(config as unknown as Record<string, unknown>, key, value);
  return null;
}

function configMenuOptions(config: OrbitConfig): PromptOption[] {
  return [
    {
      value: "permissions.mode",
      label: `🛡️  permissions.mode (current: ${config.permissions.mode})`,
    },
    {
      value: "budgetLimit",
      label: `💰 budgetLimit (current: $${config.budgetLimit})`,
    },
    {
      value: "permissions.allowRead",
      label: `📄 permissions.allowRead (current: ${config.permissions.allowRead})`,
    },
    {
      value: "permissions.requireApprovalForWrite",
      label:
        `✏️  permissions.requireApprovalForWrite (current: ${config.permissions.requireApprovalForWrite})`,
    },
    {
      value: "permissions.requireApprovalForBash",
      label:
        `🐚 permissions.requireApprovalForBash (current: ${config.permissions.requireApprovalForBash})`,
    },
    {
      value: "permissions.blockDangerousCommands",
      label:
        `🚫 permissions.blockDangerousCommands (current: ${config.permissions.blockDangerousCommands})`,
    },
    {
      value: "permissions.protectSecrets",
      label: `🔑 permissions.protectSecrets (current: ${config.permissions.protectSecrets})`,
    },
    {
      value: "tools.bash.enabled",
      label: `💻 tools.bash.enabled (current: ${config.tools.bash.enabled})`,
    },
    {
      value: "tools.webSearch.enabled",
      label: `🌐 tools.webSearch.enabled (current: ${config.tools.webSearch.enabled})`,
    },
    {
      value: "tools.webSearch.provider",
      label: `🔎 tools.webSearch.provider (current: ${config.tools.webSearch.provider})`,
    },
    {
      value: "tools.webSearch.searxngUrls",
      label: `🧭 tools.webSearch.searxngUrls (current: ${
        config.tools.webSearch.searxngUrls.join(", ") || "auto/env/local"
      })`,
    },
    {
      value: "tools.webSearch.timeoutMs",
      label: `⏱️  tools.webSearch.timeoutMs (current: ${config.tools.webSearch.timeoutMs})`,
    },
    {
      value: "tools.webSearch.maxResults",
      label: `📚 tools.webSearch.maxResults (current: ${config.tools.webSearch.maxResults})`,
    },
    {
      value: "agent.maxIterations",
      label: `🔁 agent.maxIterations (current: ${config.agent.maxIterations})`,
    },
    {
      value: "tools.mcp.enabled",
      label: `🔌 tools.mcp.enabled (current: ${config.tools.mcp.enabled})`,
    },
    {
      value: "permissions.protectedPaths",
      label: `🔒 permissions.protectedPaths (current: ${
        config.permissions.protectedPaths.join(", ")
      })`,
    },
    {
      value: "context.ignore",
      label: `🗂️  context.ignore (current: ${config.context.ignore.join(", ")})`,
    },
    { value: "editor", label: `📝 editor (current: ${config.editor})` },
    {
      value: "autoCommit",
      label: `🚀 autoCommit (current: ${config.autoCommit})`,
    },
    { value: "exit", label: "❌ Exit Menu" },
  ];
}

async function promptForValue(
  key: string,
  currentValue: unknown,
  prompt: ConfigPromptAdapter,
): Promise<unknown | undefined> {
  if (key === "permissions.mode") {
    return prompt.askSelect("Set permissions.mode to:", [
      {
        value: "strict",
        label: "strict (High security, ask for write/exec, block dangerous)",
      },
      {
        value: "normal",
        label: "normal (Standard safety, ask for all write/exec)",
      },
      {
        value: "auto",
        label: "auto (Allow write/exec automatically, block dangerous)",
      },
      {
        value: "plan",
        label: "plan (Interactive planning mode - read-only)",
      },
    ]);
  }
  if (key === "tools.webSearch.provider") {
    return prompt.askSelect("Set tools.webSearch.provider to:", [
      {
        value: "auto",
        label: "auto (SearXNG/Tavily first, Bing/DuckDuckGo fallback)",
      },
      {
        value: "searxng",
        label: "searxng (configured/self-hosted JSON endpoint)",
      },
      { value: "tavily", label: "tavily (requires TAVILY_API_KEY)" },
      {
        value: "bing",
        label: "bing (no-key HTML fallback, broadly reachable)",
      },
      { value: "duckduckgo", label: "duckduckgo (no-key HTML fallback)" },
    ]);
  }
  if (typeof currentValue === "boolean") {
    const selected = await prompt.askSelect(`Set ${key} to:`, [
      { value: "true", label: "true" },
      { value: "false", label: "false" },
    ]);
    return selected === null || selected === ""
      ? undefined
      : selected === "true";
  }
  if (typeof currentValue === "number") {
    const rawValue = await prompt.askText(
      `Enter numeric value for ${key}:`,
      String(currentValue),
    );
    if (rawValue === null || rawValue === "") return undefined;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  if (Array.isArray(currentValue)) {
    const rawValue = await prompt.askText(
      `Enter comma-separated values for ${key}:`,
      currentValue.join(", "),
    );
    return rawValue === null || rawValue === ""
      ? undefined
      : rawValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
  }
  if (typeof currentValue === "string") {
    const rawValue = await prompt.askText(
      `Enter value for ${key}:`,
      currentValue,
    );
    return rawValue === null || rawValue === "" ? undefined : rawValue;
  }
  return undefined;
}

/** Handles the direct and interactive `/config` workflows. */
export async function handleWorkspaceConfigCommand(
  configArgument: string,
  dependencies: WorkspaceConfigDependencies,
): Promise<CommandHandlerResult> {
  const { getConfig, printOutput, prompt = Prompt } = dependencies;
  const activeConfig = getConfig();

  if (configArgument) {
    const equalsIndex = configArgument.indexOf("=");
    if (equalsIndex === -1) {
      printOutput(
        picocolors.yellow(
          "Usage: /config <key>=<value> or just /config for interactive menu.",
        ),
      );
      return HANDLED_COMMAND;
    }

    const key = configArgument.slice(0, equalsIndex).trim();
    const rawValue = configArgument.slice(equalsIndex + 1).trim();
    const currentValue = getNestedProperty(activeConfig, key);
    if (currentValue === undefined) {
      printOutput(picocolors.red(`Error: Unknown configuration key "${key}".`));
      return HANDLED_COMMAND;
    }
    const parsed = parseConfigValue(key, currentValue, rawValue);
    if (!parsed.ok) {
      printOutput(picocolors.red(parsed.message));
      return HANDLED_COMMAND;
    }
    const validationError = validateAndApply(activeConfig, key, parsed.value);
    if (validationError) {
      printOutput(
        picocolors.red(`Configuration validation failed: ${validationError}`),
      );
      return HANDLED_COMMAND;
    }
    printOutput(picocolors.green(`✔ Updated "${key}" to: ${parsed.value}`));
    return HANDLED_COMMAND;
  }

  while (true) {
    const key = await prompt.askSelect(
      "Select a configuration key to modify:",
      configMenuOptions(activeConfig),
    );
    if (!key || key === "exit") return HANDLED_COMMAND;

    const currentValue = getNestedProperty(activeConfig, key);
    const nextValue = await promptForValue(key, currentValue, prompt);
    if (nextValue === undefined) continue;
    if (typeof nextValue === "number" && !Number.isFinite(nextValue)) {
      printOutput(picocolors.red(`Error: ${key} must be a valid number.`));
      continue;
    }

    const validationError = validateAndApply(activeConfig, key, nextValue);
    if (validationError) {
      printOutput(picocolors.red(`Validation error: ${validationError}`));
      continue;
    }
    const displayValue = Array.isArray(nextValue)
      ? `[${nextValue.join(", ")}]`
      : String(nextValue);
    printOutput(picocolors.green(`✔ Updated "${key}" to: ${displayValue}`));
  }
}
