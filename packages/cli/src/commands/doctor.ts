import { execSync } from "child_process";
import { existsSync } from "fs";
import { basename, join } from "path";
import picocolors from "picocolors";
import { z } from "zod";
import { ConfigLoader, type OrbitConfig } from "@orbit-build/config";
import {
  DEEPSEEK_V4_CONTEXT_TOKENS,
  DEEPSEEK_V4_FLASH_VERSION,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  isOfficialDeepSeekApi,
} from "@orbit-build/model-providers";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
} from "@orbit-build/shared";
import { buildCacheDiagnostics } from "../runtime/CacheDiagnostics.js";
import {
  formatProviderBenchmarkSummary,
  readProviderBenchmarks,
} from "../runtime/ProviderBenchmarks.js";
import {
  describeDeprecatedDeepSeekAliases,
  isDeprecatedDeepSeekAlias,
} from "../runtime/ModelCatalog.js";
import {
  formatProviderProbe,
  probeProviderCapabilities,
  readProviderProbeCache,
} from "../runtime/ProviderDiagnostics.js";
import { createProviderFromConfig } from "../runtime/ProviderFactory.js";
import { readCliVersion } from "../runtime/CliVersion.js";

type DoctorExec = (
  command: string,
  options?: Record<string, unknown>,
) => string;

interface DoctorReportOptions {
  exec?: DoctorExec;
  env?: NodeJS.ProcessEnv;
  providerProbeText?: string;
  providerProbeOk?: boolean;
  deepseek?: boolean;
}

const DoctorIssueSchema = z.object({
  severity: z.enum(["warning", "error"]),
  code: z.string().regex(/^[a-z0-9_.-]+$/),
  message: z.string().min(1).max(2_000),
  remediation: z.string().min(1).max(2_000),
});

export const DoctorSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  status: z.enum(["ok", "warning", "error"]),
  orbit: z.object({
    version: z.string(),
    configSchemaVersion: z.number().int(),
  }),
  runtime: z.object({
    node: z.string(),
    nodeSupported: z.boolean(),
    platform: z.string(),
    architecture: z.string(),
    packageManager: z.string(),
    gitVersion: z.string().nullable(),
    ripgrepVersion: z.string().nullable(),
    gitDirty: z.boolean().nullable(),
  }),
  workspace: z.object({ name: z.string(), pathRedacted: z.literal(true) }),
  provider: z.object({
    id: z.string(),
    type: z.string().nullable(),
    baseUrl: z.string().nullable(),
    apiKeyLoaded: z.boolean(),
    apiKeySource: z.string(),
    deepSeekProfile: z.boolean(),
    models: z.record(z.string()),
    probe: z.string().nullable(),
  }),
  features: z.object({
    webSearch: z.boolean(),
    mcp: z.boolean(),
    mcpServerCount: z.number().int().nonnegative(),
    skills: z.boolean(),
    automaticCompaction: z.boolean(),
  }),
  safety: z.object({
    permissionMode: z.enum(["strict", "normal", "auto", "plan"]),
    writeApproval: z.boolean(),
    commandApproval: z.boolean(),
    dangerousCommandBlocking: z.boolean(),
    secretProtection: z.boolean(),
    projectExecutablesTrusted: z.boolean(),
  }),
  issues: z.array(DoctorIssueSchema),
});

export type DoctorSnapshot = z.infer<typeof DoctorSnapshotSchema>;

function defaultExec(command: string, options: Record<string, unknown> = {}) {
  return execSync(command, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    ...options,
  }) as string;
}

function commandOutput(
  exec: DoctorExec,
  command: string,
  cwd?: string,
): string | undefined {
  try {
    return exec(command, cwd ? { cwd } : undefined).trim();
  } catch {
    return undefined;
  }
}

function statusLine(ok: boolean, text: string, warn = false): string {
  if (ok) return picocolors.green(`✔ ${text}`);
  return warn ? picocolors.yellow(`⚠️ ${text}`) : picocolors.red(`✖ ${text}`);
}

function packageManager(cwd: string): string {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  if (existsSync(join(cwd, "package.json"))) return "npm";
  return "unknown";
}

function boolText(value: boolean): string {
  return value ? picocolors.green("on") : picocolors.yellow("off");
}

function providerLooksLikeDeepSeek(providerId: string, config: OrbitConfig) {
  const provider = config.providers[providerId];
  const haystack = [
    providerId,
    provider?.type,
    provider?.baseUrl,
    config.models.default,
    config.models.fast,
    config.models.planner,
    config.models.coder,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("deepseek");
}

function apiKeyLoaded(providerId: string, config: OrbitConfig) {
  const provider = config.providers[providerId];
  if (!provider) return false;
  try {
    return Boolean(provider.apiKey);
  } catch {
    return false;
  }
}

function allConfiguredModelNames(config: OrbitConfig): string[] {
  return Array.from(
    new Set(
      Object.values(config.models)
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function sanitizeDiagnosticUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "[invalid URL]";
  }
}

/** Build a stable, credential-safe snapshot for support automation. */
export function buildDoctorSnapshot(
  cwd: string,
  config: OrbitConfig = ConfigLoader.loadSync(cwd),
  options: DoctorReportOptions = {},
): DoctorSnapshot {
  const exec = options.exec || defaultExec;
  const defaultProvider = config.provider.default;
  const provider = config.providers[defaultProvider];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const gitVersion = commandOutput(exec, "git --version", cwd)?.replace(
    /^git version\s+/i,
    "",
  );
  const ripgrepVersion = commandOutput(exec, "rg --version", cwd)
    ?.split("\n")[0]
    ?.replace(/^ripgrep\s+/i, "");
  const gitStatus = commandOutput(exec, "git status --short", cwd);
  const hasApiKey = apiKeyLoaded(defaultProvider, config);
  const isDeepSeekProfile = providerLooksLikeDeepSeek(defaultProvider, config);
  const models = Object.fromEntries(
    Object.entries(config.models).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const configuredModels = allConfiguredModelNames(config);
  const issues: DoctorSnapshot["issues"] = [];

  if (nodeMajor < 20) {
    issues.push({
      severity: "error",
      code: "runtime.node.unsupported",
      message: `Node.js ${process.version} is unsupported.`,
      remediation: "Install Node.js 20 or newer and restart Orbit.",
    });
  }
  if (!gitVersion) {
    issues.push({
      severity: "warning",
      code: "runtime.git.missing",
      message:
        "Git is unavailable; recovery is limited to filesystem checkpoints.",
      remediation: "Install Git and ensure it is available on PATH.",
    });
  }
  if (!ripgrepVersion) {
    issues.push({
      severity: "warning",
      code: "runtime.ripgrep.missing",
      message:
        "Ripgrep is unavailable; repository search will use a slower fallback.",
      remediation: "Install ripgrep and ensure rg is available on PATH.",
    });
  }
  if (!provider) {
    issues.push({
      severity: "error",
      code: "provider.missing",
      message: `Default provider ${defaultProvider} is not configured.`,
      remediation: "Choose a configured provider in Orbit configuration.",
    });
  } else if (provider.type !== "ollama" && !hasApiKey) {
    issues.push({
      severity: "error",
      code: "provider.api_key.missing",
      message: `No credential is available from ${provider.apiKeyEnv || "the configured provider key"}.`,
      remediation:
        "Run orbit login or set the configured credential environment variable.",
    });
  }
  const deprecatedAliases = configuredModels.filter(isDeprecatedDeepSeekAlias);
  if (deprecatedAliases.length > 0) {
    issues.push({
      severity: "warning",
      code: "provider.deepseek.alias_deprecated",
      message: `Deprecated DeepSeek aliases are configured: ${deprecatedAliases.join(", ")}.`,
      remediation:
        "Replace legacy aliases with deepseek-v4-flash or deepseek-v4-pro.",
    });
  }
  if (
    isDeepSeekProfile &&
    provider?.baseUrl &&
    !isOfficialDeepSeekApi(provider.baseUrl)
  ) {
    issues.push({
      severity: "warning",
      code: "provider.deepseek.endpoint_nonofficial",
      message: "The active DeepSeek profile uses a non-official endpoint.",
      remediation:
        "Confirm the gateway supports the selected DeepSeek V4 models and telemetry fields.",
    });
  }
  if (config.tools.mcp.enabled && Object.keys(config.mcpServers).length === 0) {
    issues.push({
      severity: "warning",
      code: "mcp.servers.empty",
      message: "MCP is enabled but no servers are configured.",
      remediation:
        "Configure an MCP server or disable MCP until one is needed.",
    });
  }
  if (options.providerProbeOk === false) {
    issues.push({
      severity: "error",
      code: "provider.probe.failed",
      message: "The live provider capability probe failed.",
      remediation:
        "Check the endpoint, credential, model name, proxy, and network access.",
    });
  }

  const status = issues.some((issue) => issue.severity === "error")
    ? "error"
    : issues.length > 0
      ? "warning"
      : "ok";
  const probe = options.providerProbeText
    ? redactSecrets(stripAnsi(options.providerProbeText)).slice(0, 2_000)
    : null;

  return DoctorSnapshotSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    orbit: {
      version: readCliVersion(),
      configSchemaVersion: config.schemaVersion,
    },
    runtime: {
      node: process.version,
      nodeSupported: nodeMajor >= 20,
      platform: process.platform,
      architecture: process.arch,
      packageManager: packageManager(cwd),
      gitVersion: gitVersion || null,
      ripgrepVersion: ripgrepVersion || null,
      gitDirty: gitStatus === undefined ? null : gitStatus.length > 0,
    },
    workspace: {
      name: basename(cwd) || "workspace",
      pathRedacted: true,
    },
    provider: {
      id: defaultProvider,
      type: provider?.type || null,
      baseUrl: sanitizeDiagnosticUrl(provider?.baseUrl),
      apiKeyLoaded: hasApiKey,
      apiKeySource: provider?.apiKeyEnv || "configured provider key",
      deepSeekProfile: isDeepSeekProfile,
      deepSeekApiFormat: provider?.deepSeekApiFormat || "chat-completions",
      deepSeekFlashVersion: DEEPSEEK_V4_FLASH_VERSION,
      models,
      probe,
    },
    features: {
      webSearch: config.tools.webSearch.enabled,
      mcp: config.tools.mcp.enabled,
      mcpServerCount: Object.keys(config.mcpServers).length,
      skills: config.skills.enabled,
      automaticCompaction: config.context.autoCompact,
    },
    safety: {
      permissionMode: config.permissions.mode,
      writeApproval: config.permissions.requireApprovalForWrite,
      commandApproval: config.permissions.requireApprovalForBash,
      dangerousCommandBlocking: config.permissions.blockDangerousCommands,
      secretProtection: config.permissions.protectSecrets,
      projectExecutablesTrusted: config.security.trustProjectExecutables,
    },
    issues,
  });
}

function buildDeepSeekDoctorSection(cwd: string, config: OrbitConfig): string {
  const providerId = config.provider.default;
  const provider = config.providers[providerId];
  const models = allConfiguredModelNames(config);
  const deprecatedAliases = models.filter(isDeprecatedDeepSeekAlias);
  const deepseekV4Models = models.filter((model) =>
    /deepseek-v4-(flash|pro)/i.test(model),
  );
  const targetModel = config.models.default;
  const benchmarks = readProviderBenchmarks(cwd).filter(
    (item) => item.providerId === providerId && item.model === targetModel,
  );
  const successfulBenchmarks = benchmarks.filter((item) => !item.error);
  const cacheReference = successfulBenchmarks.find(
    (item) => item.cacheInputTokens >= 512,
  );
  const matchingCacheProfile = cacheReference
    ? successfulBenchmarks.filter(
        (item) =>
          item.cacheInputTokens >= 512 &&
          item.promptHash === cacheReference.promptHash &&
          item.thinkingMode === cacheReference.thinkingMode,
      )
    : [];
  // History is newest-first. Exclude the oldest baseline when repeats exist.
  const recentCacheHits =
    matchingCacheProfile.length > 1
      ? matchingCacheProfile.slice(0, -1)
      : matchingCacheProfile;
  const avgCacheHit =
    recentCacheHits.length > 0
      ? recentCacheHits.reduce((sum, item) => sum + item.cacheHitRate, 0) /
        recentCacheHits.length
      : undefined;
  const latestFirstDelta = successfulBenchmarks.find(
    (item) => typeof item.firstDeltaMs === "number",
  )?.firstDeltaMs;
  const lines = ["", picocolors.bold("DeepSeek Official Alignment")];

  lines.push(
    statusLine(
      providerLooksLikeDeepSeek(providerId, config),
      "Default provider/model profile targets DeepSeek.",
      true,
    ),
  );
  lines.push(
    statusLine(
      Boolean(provider?.baseUrl && isOfficialDeepSeekApi(provider.baseUrl)),
      provider?.baseUrl
        ? `Base URL is ${provider.baseUrl}.`
        : "Provider base URL is not configured.",
      true,
    ),
  );
  lines.push(
    statusLine(
      deprecatedAliases.length === 0,
      describeDeprecatedDeepSeekAliases(models),
      true,
    ),
  );
  lines.push(
    statusLine(
      deepseekV4Models.length > 0,
      deepseekV4Models.length > 0
        ? `DeepSeek V4 model roles: ${deepseekV4Models.join(", ")}.`
        : "No DeepSeek V4 flash/pro model role detected.",
      true,
    ),
  );
  lines.push(
    statusLine(
      provider?.type === "openai-compatible" ||
        provider?.type === "anthropic-compatible",
      `Provider type ${provider?.type || "missing"} supports DeepSeek-compatible routing.`,
      true,
    ),
  );
  lines.push(
    picocolors.gray(
      `● Model profile: ${DEEPSEEK_V4_FLASH_VERSION}; ${DEEPSEEK_V4_CONTEXT_TOKENS.toLocaleString("en-US")} context tokens and ${DEEPSEEK_V4_MAX_OUTPUT_TOKENS.toLocaleString("en-US")} maximum output tokens.`,
    ),
  );
  lines.push(
    picocolors.gray(
      `● Orbit 0731 policy: Flash=${config.agent?.fastMaxOutputTokens ?? 8192} output tokens with thinking low for simple work, high for complex work, and max for repair; Pro=${config.agent?.maxOutputTokens ?? 16384} with thinking high/max.`,
    ),
  );
  lines.push(
    picocolors.gray(
      `● DeepSeek API format: ${provider?.deepSeekApiFormat ?? "chat-completions"}. Official Flash uses Responses in auto mode; compatible gateways use their configured DeepSeek transport.`,
    ),
  );
  lines.push(
    latestFirstDelta !== undefined
      ? picocolors.gray(
          `● Recent ${targetModel} first model delta: ${latestFirstDelta}ms (local observation, not an official SLA).`,
        )
      : picocolors.gray(
          `● No recent ${targetModel} latency sample. Run orbit bench --model ${targetModel} --repeat 3.`,
        ),
  );
  lines.push(
    avgCacheHit !== undefined
      ? picocolors.gray(
          `● Latest repeated-prefix cache average for ${targetModel}: ${Math.round(avgCacheHit * 100)}% (${recentCacheHits.length} repeated sample(s)).`,
        )
      : picocolors.gray(
          `● No comparable repeated-prefix cache samples for ${targetModel}. Run orbit bench --model ${targetModel} --cache-profile --repeat 3.`,
        ),
  );
  lines.push(
    picocolors.gray(
      "● Cache policy: automatic persisted request boundaries, byte-stable prefixes, no synthetic primer/keepalive traffic, and a workspace-stable user_id.",
    ),
  );
  return lines.join("\n");
}

export function buildDoctorReport(
  cwd: string,
  config: OrbitConfig = ConfigLoader.loadSync(cwd),
  options: DoctorReportOptions = {},
): string {
  const exec = options.exec || defaultExec;
  const env = options.env || process.env;
  const lines: string[] = [];
  const defaultProvider = config.provider.default;
  const provider = config.providers[defaultProvider];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const gitVersion = commandOutput(exec, "git --version", cwd);
  const rgVersion = commandOutput(exec, "rg --version", cwd)?.split("\n")[0];
  const gitStatus = commandOutput(exec, "git status --short", cwd);
  const webSearch = config.tools.webSearch;
  const skills = config.skills;
  const mcpServers = Object.keys(config.mcpServers || {});
  const providerKeyName = provider?.apiKeyEnv || "configured provider key";
  const hasApiKey = apiKeyLoaded(defaultProvider, config);
  const tavilyKeyName = webSearch.tavilyApiKeyEnv || "TAVILY_API_KEY";
  const searxngConfigured =
    webSearch.searxngUrls.length > 0 ||
    Boolean(env.ORBIT_SEARXNG_URL || env.SEARXNG_URL);
  const isDeepSeekProfile = providerLooksLikeDeepSeek(defaultProvider, config);

  lines.push(picocolors.bold("Orbit Diagnostics"));
  lines.push("");
  lines.push(picocolors.bold("Runtime"));
  lines.push(
    statusLine(
      nodeMajor >= 20,
      `Node.js ${process.version}${nodeMajor >= 20 ? " supported" : " requires v20+"}`,
    ),
  );
  lines.push(
    gitVersion
      ? picocolors.green(`✔ Git ${gitVersion.replace(/^git version\s+/i, "")}`)
      : picocolors.yellow(
          "⚠️ Git not found; checkpoint fallback will be filesystem-only.",
        ),
  );
  lines.push(
    rgVersion
      ? picocolors.green(`✔ Ripgrep ${rgVersion.replace(/^ripgrep\s+/i, "")}`)
      : picocolors.yellow(
          "⚠️ Ripgrep not found; code search will use slower fallback scanning.",
        ),
  );
  lines.push(`● Workspace: ${picocolors.cyan(cwd)}`);
  lines.push(`● Package manager: ${picocolors.cyan(packageManager(cwd))}`);
  if (gitStatus !== undefined) {
    lines.push(
      gitStatus
        ? picocolors.yellow("⚠️ Git workspace has local changes.")
        : picocolors.green("✔ Git workspace is clean."),
    );
  }

  lines.push("");
  lines.push(picocolors.bold("Models"));
  lines.push(`● Provider: ${picocolors.cyan(defaultProvider)}`);
  lines.push(
    provider
      ? picocolors.green(`✔ Provider type: ${provider.type}`)
      : picocolors.red(`✖ Provider config missing: ${defaultProvider}`),
  );
  if (provider?.baseUrl) {
    lines.push(`● Base URL: ${picocolors.cyan(provider.baseUrl)}`);
  }
  lines.push(
    statusLine(
      hasApiKey || provider?.type === "ollama",
      provider?.type === "ollama"
        ? "API key not required for Ollama."
        : hasApiKey
          ? `API key loaded from ${providerKeyName}.`
          : `API key not found in ${providerKeyName}; run \`orbit login\` or set the environment variable.`,
    ),
  );
  lines.push(
    statusLine(
      isDeepSeekProfile,
      isDeepSeekProfile
        ? "DeepSeek V4 automatic-cache profile is active."
        : "Default provider is not DeepSeek; DeepSeek cache benefits may not apply.",
      true,
    ),
  );
  lines.push(
    `● Roles: default=${picocolors.cyan(config.models.default)}, fast=${picocolors.cyan(
      config.models.fast,
    )}, planner=${picocolors.cyan(config.models.planner)}, coder=${picocolors.cyan(
      config.models.coder,
    )}, reviewer=${picocolors.cyan(config.models.reviewer)}, summarizer=${picocolors.cyan(config.models.summarizer)}`,
  );
  if (options.providerProbeText) {
    lines.push(options.providerProbeText);
  } else {
    const cachedProbe = readProviderProbeCache(cwd).find(
      (item) =>
        item.providerId === defaultProvider &&
        item.model === config.models.default,
    );
    if (cachedProbe) {
      lines.push(picocolors.gray(formatProviderProbe(cachedProbe)));
    } else {
      lines.push(
        picocolors.gray(
          "● Provider probe: no cached result yet. Run `orbit doctor --probe` to test streaming and usage support.",
        ),
      );
    }
  }
  lines.push(
    formatProviderBenchmarkSummary(cwd, defaultProvider, config.models.default),
  );

  lines.push("");
  lines.push(picocolors.bold("Tools"));
  lines.push(
    `● Bash: ${boolText(config.tools.bash.enabled)} timeout=${config.tools.bash.timeoutMs}ms`,
  );
  lines.push(
    `● Web search: ${boolText(webSearch.enabled)} provider=${picocolors.cyan(
      webSearch.provider,
    )} maxResults=${webSearch.maxResults} timeout=${webSearch.timeoutMs}ms`,
  );
  lines.push(
    statusLine(
      webSearch.enabled,
      "Realtime lookup enabled; weather queries use direct Open-Meteo first.",
      true,
    ),
  );
  lines.push(
    statusLine(
      searxngConfigured ||
        Boolean(env[tavilyKeyName]) ||
        webSearch.provider !== "auto",
      `Search backend configured: searxng=${searxngConfigured ? "yes" : "no"}, tavilyKey=${
        env[tavilyKeyName] ? "yes" : "no"
      }, fallback=${webSearch.provider}.`,
      true,
    ),
  );
  lines.push(
    `● MCP: ${boolText(config.tools.mcp.enabled)} servers=${mcpServers.length}`,
  );

  lines.push("");
  lines.push(picocolors.bold("Skills"));
  lines.push(
    `● Skills: ${boolText(skills.enabled)} activation=${picocolors.cyan(
      skills.activation,
    )} maxActive=${skills.maxActive} maxBytes=${skills.maxSkillBytes} maxAutoBytes=${skills.maxAutoSkillBytes}`,
  );
  lines.push(
    `● Skill dirs: ${skills.directories.map((dir) => picocolors.cyan(dir)).join(", ")}`,
  );

  lines.push("");
  lines.push(picocolors.bold("Safety & Context"));
  lines.push(
    `● Mode: ${picocolors.cyan(config.permissions.mode)} writeApproval=${boolText(
      config.permissions.requireApprovalForWrite,
    )} bashApproval=${boolText(config.permissions.requireApprovalForBash)}`,
  );
  lines.push(
    `● Guards: dangerous=${boolText(config.permissions.blockDangerousCommands)} secrets=${boolText(
      config.permissions.protectSecrets,
    )}`,
  );
  lines.push(
    `● Context: maxFiles=${config.context.maxFilesToIndex} maxFile=${config.context.maxFileSizeKb}KB autoCompact=${boolText(
      config.context.autoCompact,
    )} threshold=${config.context.compactThreshold}`,
  );

  lines.push("");
  lines.push(picocolors.bold("Prompt Cache"));
  lines.push(buildCacheDiagnostics(cwd));
  if (options.deepseek || isDeepSeekProfile) {
    lines.push(buildDeepSeekDoctorSection(cwd, config));
  }

  return lines.join("\n");
}

export async function runDoctor(
  cwd: string,
  options: {
    probe?: boolean;
    deepseek?: boolean;
    json?: boolean;
    strict?: boolean;
    provider?: string;
  } = {},
): Promise<void> {
  const config = ConfigLoader.loadSync(
    cwd,
    options.provider ? { provider: { default: options.provider } } : undefined,
  );
  let providerProbeText: string | undefined;
  let providerProbeOk: boolean | undefined;
  if (options.probe) {
    try {
      const provider = createProviderFromConfig(config);
      providerProbeText = formatProviderProbe(
        await probeProviderCapabilities(cwd, config, provider),
      );
      providerProbeOk = true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      providerProbeText = picocolors.red(
        `Provider probe failed: ${redactSecrets(message)}`,
      );
      providerProbeOk = false;
    }
  }
  const reportOptions = {
    providerProbeText,
    providerProbeOk,
    deepseek: !!options.deepseek,
  };
  const snapshot = buildDoctorSnapshot(cwd, config, reportOptions);
  console.log(
    options.json
      ? JSON.stringify(snapshot, null, 2)
      : buildDoctorReport(cwd, config, reportOptions),
  );
  if (options.strict && snapshot.status !== "ok") process.exitCode = 1;
}
