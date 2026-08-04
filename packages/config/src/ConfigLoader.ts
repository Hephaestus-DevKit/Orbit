import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { parse } from "yaml";
import {
  ConfigSchema,
  ORBIT_CONFIG_SCHEMA_VERSION,
  OrbitConfig,
  PricingTableSchema,
} from "./schema.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { CredentialsManager } from "./Credentials.js";
import { ProviderProfileStore } from "./ProviderProfiles.js";
import { applyManagedPolicy, loadManagedPolicy } from "./ManagedPolicy.js";
import { applyInstalledExtensionContributions } from "./InstalledExtensions.js";
import { resolve } from "path";
import { parseOrbitLanguage } from "./language.js";
import { readBoundedRegularFile } from "@orbit-build/shared";

const MAX_CONFIG_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PRICING_FILE_BYTES = 1024 * 1024;

export interface ConfigLoadOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  credentialsManager?: CredentialsManager;
  providerProfileStore?: ProviderProfileStore;
  trustProjectExecutables?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeUntrustedProjectConfig(
  source: unknown,
  baseline: OrbitConfig,
): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const safe: Record<string, unknown> = {};

  for (const key of ["name", "language", "tui"] as const) {
    if (source[key] !== undefined) safe[key] = source[key];
  }

  if (isRecord(source.context)) {
    const context = { ...source.context };
    delete context.testCommands;
    if (context.autoRepair !== false) delete context.autoRepair;
    if (typeof context.maxFilesToIndex === "number") {
      context.maxFilesToIndex = Math.min(
        context.maxFilesToIndex,
        baseline.context.maxFilesToIndex,
      );
    }
    if (typeof context.maxFileSizeKb === "number") {
      context.maxFileSizeKb = Math.min(
        context.maxFileSizeKb,
        baseline.context.maxFileSizeKb,
      );
    }
    safe.context = context;
  }

  if (
    isRecord(source.agent) &&
    typeof source.agent.maxIterations === "number"
  ) {
    safe.agent = {
      maxIterations: Math.min(
        source.agent.maxIterations,
        baseline.agent.maxIterations,
      ),
    };
  }

  if (isRecord(source.permissions)) {
    const permissions: Record<string, unknown> = {};
    const requestedMode = source.permissions.mode;
    if (
      typeof requestedMode === "string" &&
      permissionSafetyRank(requestedMode) >=
        permissionSafetyRank(baseline.permissions.mode)
    ) {
      permissions.mode = requestedMode;
    }
    if (source.permissions.allowRead === false) permissions.allowRead = false;
    for (const key of [
      "requireApprovalForWrite",
      "requireApprovalForBash",
      "blockDangerousCommands",
      "protectSecrets",
    ] as const) {
      if (source.permissions[key] === true) permissions[key] = true;
    }
    if (Array.isArray(source.permissions.protectedPaths)) {
      permissions.protectedPaths = Array.from(
        new Set([
          ...baseline.permissions.protectedPaths,
          ...source.permissions.protectedPaths.filter(
            (item): item is string => typeof item === "string",
          ),
        ]),
      );
    }
    safe.permissions = permissions;
  }

  if (isRecord(source.tools)) {
    const tools: Record<string, unknown> = {};
    if (isRecord(source.tools.bash)) {
      const bash: Record<string, unknown> = {};
      if (source.tools.bash.enabled === false) bash.enabled = false;
      if (typeof source.tools.bash.timeoutMs === "number") {
        bash.timeoutMs = Math.min(
          source.tools.bash.timeoutMs,
          baseline.tools.bash.timeoutMs,
        );
      }
      tools.bash = bash;
    }
    if (isRecord(source.tools.backgroundTasks)) {
      const backgroundTasks: Record<string, unknown> = {};
      for (const key of [
        "maxConcurrentTasks",
        "maxRetainedTasks",
        "maxOutputBytes",
        "terminateGraceMs",
        "completionWaitMs",
      ] as const) {
        const requested = source.tools.backgroundTasks[key];
        const baselineValue = baseline.tools.backgroundTasks[key];
        if (typeof requested === "number") {
          backgroundTasks[key] = Math.min(requested, baselineValue);
        }
      }
      if (source.tools.backgroundTasks.awaitOnCompletion === false) {
        backgroundTasks.awaitOnCompletion = false;
      }
      const concurrent = backgroundTasks.maxConcurrentTasks;
      const retained = backgroundTasks.maxRetainedTasks;
      const effectiveConcurrent =
        typeof concurrent === "number"
          ? concurrent
          : baseline.tools.backgroundTasks.maxConcurrentTasks;
      const effectiveRetained =
        typeof retained === "number"
          ? retained
          : baseline.tools.backgroundTasks.maxRetainedTasks;
      if (
        effectiveConcurrent > 0 &&
        effectiveRetained > 0 &&
        effectiveRetained < effectiveConcurrent
      ) {
        backgroundTasks.maxConcurrentTasks = effectiveRetained;
      }
      tools.backgroundTasks = backgroundTasks;
    }
    if (isRecord(source.tools.webSearch)) {
      tools.webSearch = {
        ...(source.tools.webSearch.enabled === false ? { enabled: false } : {}),
      };
    }
    if (isRecord(source.tools.mcp)) {
      tools.mcp = {
        ...(source.tools.mcp.enabled === false ? { enabled: false } : {}),
      };
    }
    safe.tools = tools;
  }

  if (isRecord(source.skills)) {
    const skills: Record<string, unknown> = {};
    if (source.skills.enabled === false) skills.enabled = false;
    if (source.skills.activation === "explicit") skills.activation = "explicit";
    if (Array.isArray(source.skills.disabled)) {
      skills.disabled = source.skills.disabled.filter(
        (name): name is string => typeof name === "string",
      );
    }
    for (const key of [
      "maxActive",
      "maxSkillBytes",
      "maxAutoSkillBytes",
    ] as const) {
      if (typeof source.skills[key] === "number") {
        skills[key] = Math.min(source.skills[key], baseline.skills[key]);
      }
    }
    safe.skills = skills;
  }

  return safe;
}

function permissionSafetyRank(mode: string): number {
  switch (mode) {
    case "plan":
      return 3;
    case "strict":
      return 2;
    case "normal":
      return 1;
    case "auto":
      return 0;
    default:
      return -1;
  }
}

function warnIgnoredConfiguration(filePath: string): void {
  // Parser errors can echo nearby YAML source, which may contain credentials.
  console.warn(`Warning: Invalid configuration at ${filePath}; file ignored.`);
}

function hasUnsupportedSchemaVersion(source: unknown): boolean {
  if (!isRecord(source) || source.schemaVersion === undefined) return false;
  return source.schemaVersion !== ORBIT_CONFIG_SCHEMA_VERSION;
}

function warnUnsupportedConfiguration(filePath: string): void {
  console.warn(
    `Warning: Configuration at ${filePath} uses an unsupported schema version; Orbit supports version ${ORBIT_CONFIG_SCHEMA_VERSION}. File ignored.`,
  );
}

function migrateLegacySessionPath(sessionPath: string): string {
  const normalized = sessionPath.trim();
  if (/^\.orbit[\\/]sessions\.sqlite$/i.test(normalized)) {
    return ".orbit/sessions";
  }
  return normalized.replace(/\.(?:sqlite3?|db)$/i, ".sessions");
}

export class ConfigLoader {
  private static merge<T>(target: T, source: unknown): T {
    if (!isRecord(source)) return target;
    const result: Record<string, unknown> = isRecord(target)
      ? { ...target }
      : {};
    for (const key of Object.keys(source)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      const sourceValue = source[key];
      if (isRecord(sourceValue)) {
        result[key] = this.merge(result[key] ?? {}, sourceValue);
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue;
      }
    }
    return result as T;
  }

  public static loadSync(
    cwd: string,
    cliOverrides?: Partial<OrbitConfig>,
    options: ConfigLoadOptions = {},
  ): OrbitConfig {
    let config = structuredClone(DEFAULT_CONFIG);
    const homeDirectory = options.homeDir ?? homedir();
    const env = options.env ?? process.env;

    // 1. Load User Global Config (~/.orbit/config.yaml)
    const globalConfigPath = join(homeDirectory, ".orbit", "config.yaml");
    try {
      const raw = readBoundedRegularFile(
        globalConfigPath,
        MAX_CONFIG_FILE_BYTES,
        { allowSymbolicLink: true },
      );
      if (raw !== undefined) {
        const parsed = parse(raw);
        if (hasUnsupportedSchemaVersion(parsed)) {
          warnUnsupportedConfiguration(globalConfigPath);
        } else {
          const merged = ConfigSchema.safeParse(this.merge(config, parsed));
          if (merged.success) {
            config = merged.data;
          } else {
            warnIgnoredConfiguration(globalConfigPath);
          }
        }
      }
    } catch {
      warnIgnoredConfiguration(globalConfigPath);
    }

    // Saved provider profiles are user-level metadata. API keys remain in the
    // encrypted credential store and are resolved lazily below.
    const profileStore =
      options.providerProfileStore ??
      new ProviderProfileStore({ orbitDir: join(homeDirectory, ".orbit") });
    const providerProfiles = profileStore.read();
    for (const profile of providerProfiles.profiles) {
      config.providers[profile.id] = this.merge(
        config.providers[profile.id] ?? {},
        profile.config,
      );
    }
    if (
      providerProfiles.activeProvider &&
      config.providers[providerProfiles.activeProvider]
    ) {
      config.provider.default = providerProfiles.activeProvider;
    }
    const trustProjectExecutables =
      options.trustProjectExecutables ??
      config.security?.trustProjectExecutables ??
      false;

    // 2. Load Project Config (cwd/orbit.config.yaml)
    const projectConfigPath = join(cwd, "orbit.config.yaml");
    try {
      const raw = readBoundedRegularFile(
        projectConfigPath,
        MAX_CONFIG_FILE_BYTES,
        { allowSymbolicLink: true },
      );
      if (raw !== undefined) {
        const parsed = parse(raw);
        if (hasUnsupportedSchemaVersion(parsed)) {
          warnUnsupportedConfiguration(projectConfigPath);
        } else {
          const projectConfig = trustProjectExecutables
            ? parsed
            : sanitizeUntrustedProjectConfig(parsed, config);
          const merged = ConfigSchema.safeParse(
            this.merge(config, projectConfig),
          );
          if (merged.success) {
            config = merged.data;
          } else {
            warnIgnoredConfiguration(projectConfigPath);
          }
        }
      }
    } catch {
      warnIgnoredConfiguration(projectConfigPath);
    }

    // 3. Apply Environment Variable overrides
    config = this.applyEnvOverrides(config, env);

    // Load external pricing directory if it exists (~/.orbit/pricing.json)
    const pricingPath = join(homeDirectory, ".orbit", "pricing.json");
    try {
      const raw = readBoundedRegularFile(pricingPath, MAX_PRICING_FILE_BYTES, {
        allowSymbolicLink: true,
      });
      if (raw !== undefined) {
        const parsed = PricingTableSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          config.pricing = { ...config.pricing, ...parsed.data };
        } else {
          warnIgnoredConfiguration(pricingPath);
        }
      }
    } catch {
      warnIgnoredConfiguration(pricingPath);
    }

    // 4. Apply CLI overrides
    if (cliOverrides) {
      config = this.merge(config, cliOverrides);
    }

    // 5. Load integrity-checked contributions installed with explicit trust.
    config = applyInstalledExtensionContributions(
      ConfigSchema.parse(config),
      homeDirectory,
    );

    // 6. Apply administrator policy last so lower-precedence sources cannot
    // weaken provider, model, permission, network, or budget restrictions.
    const managedPolicyPath = env.ORBIT_MANAGED_POLICY
      ? resolve(env.ORBIT_MANAGED_POLICY)
      : join(homeDirectory, ".orbit", "policy.yaml");
    if (existsSync(managedPolicyPath)) {
      try {
        config = applyManagedPolicy(
          ConfigSchema.parse(config),
          loadManagedPolicy(managedPolicyPath),
        );
      } catch {
        throw new Error(
          `Managed policy validation failed at ${managedPolicyPath}.`,
        );
      }
    }

    // 7. Validate with Zod
    const validated = ConfigSchema.safeParse(config);
    if (!validated.success) {
      throw new Error(
        `Configuration validation failed: ${validated.error.message}`,
      );
    }

    // 8. Dynamically resolve apiKey using apiKeyEnv if apiKey not directly set
    const finalConfig = validated.data;
    // Orbit historically advertised SQLite without implementing it; storage
    // has always been directory-based JSON/JSONL. Transparently migrate old
    // configuration so existing users keep their sessions in a real format.
    if (finalConfig.session.store === "sqlite") {
      finalConfig.session = {
        store: "jsonl",
        path: migrateLegacySessionPath(finalConfig.session.path),
      };
    }
    const credsManager =
      options.credentialsManager ??
      new CredentialsManager({ orbitDir: join(homeDirectory, ".orbit") });
    for (const key of Object.keys(finalConfig.providers)) {
      const provider = finalConfig.providers[key];
      if (!provider.apiKey && provider.apiKeyEnv) {
        let cachedKey: string | undefined = undefined;
        let resolved = false;
        Object.defineProperty(provider, "apiKey", {
          get() {
            if (resolved) return cachedKey;
            let keyVal = env[provider.apiKeyEnv!];
            if (!keyVal) {
              keyVal = credsManager.getSecret(provider.apiKeyEnv!) || undefined;
            }
            cachedKey = keyVal;
            resolved = true;
            return cachedKey;
          },
          set(val) {
            cachedKey = val;
            resolved = true;
          },
          configurable: true,
          enumerable: false,
        });
      }
    }

    return finalConfig;
  }

  private static applyEnvOverrides(
    config: OrbitConfig,
    env: NodeJS.ProcessEnv,
  ): OrbitConfig {
    const nextConfig = { ...config };

    const language = parseOrbitLanguage(env.ORBIT_LANGUAGE || env.ORBIT_LANG);
    if (language) {
      nextConfig.language = language;
    }

    if (env.DEEPSEEK_BASE_URL) {
      if (nextConfig.providers["deepseek-openai"]) {
        nextConfig.providers["deepseek-openai"].baseUrl = env.DEEPSEEK_BASE_URL;
      }
    }
    if (env.DEEPSEEK_API_KEY) {
      if (nextConfig.providers["deepseek-openai"]) {
        nextConfig.providers["deepseek-openai"].apiKey = env.DEEPSEEK_API_KEY;
      }
    }

    if (env.ANTHROPIC_BASE_URL) {
      if (nextConfig.providers["deepseek-anthropic"]) {
        nextConfig.providers["deepseek-anthropic"].baseUrl =
          env.ANTHROPIC_BASE_URL;
      }
      if (nextConfig.providers["anthropic"]) {
        nextConfig.providers["anthropic"].baseUrl = env.ANTHROPIC_BASE_URL;
      }
    }
    if (env.ANTHROPIC_AUTH_TOKEN) {
      if (nextConfig.providers["deepseek-anthropic"]) {
        nextConfig.providers["deepseek-anthropic"].apiKey =
          env.ANTHROPIC_AUTH_TOKEN;
      }
    }
    if (env.ANTHROPIC_API_KEY) {
      if (nextConfig.providers["anthropic"]) {
        nextConfig.providers["anthropic"].apiKey = env.ANTHROPIC_API_KEY;
      }
    }

    if (env.OPENAI_BASE_URL) {
      if (nextConfig.providers["openai"]) {
        nextConfig.providers["openai"].baseUrl = env.OPENAI_BASE_URL;
      }
    }
    if (env.OPENAI_API_KEY) {
      if (nextConfig.providers["openai"]) {
        nextConfig.providers["openai"].apiKey = env.OPENAI_API_KEY;
      }
    }

    if (env.OLLAMA_BASE_URL) {
      if (nextConfig.providers["ollama"]) {
        nextConfig.providers["ollama"].baseUrl = env.OLLAMA_BASE_URL;
      }
    }

    if (env.DEEPSEEK_MODEL) {
      nextConfig.models.default = env.DEEPSEEK_MODEL;
    }
    if (env.ANTHROPIC_MODEL) {
      nextConfig.models.default = env.ANTHROPIC_MODEL;
    }
    if (env.OPENAI_MODEL) {
      nextConfig.models.default = env.OPENAI_MODEL;
    }
    if (env.OLLAMA_MODEL) {
      nextConfig.models.default = env.OLLAMA_MODEL;
    }

    const defaultProviderConfig =
      nextConfig.providers?.[nextConfig.provider?.default || ""];
    if (defaultProviderConfig) {
      if (env.ORBIT_PROVIDER_MODELS) {
        defaultProviderConfig.models = env.ORBIT_PROVIDER_MODELS.split(",")
          .map((model) => model.trim())
          .filter(Boolean);
      }
      if (env.ORBIT_PROVIDER_API_KEY_HEADER) {
        defaultProviderConfig.apiKeyHeader = env.ORBIT_PROVIDER_API_KEY_HEADER;
      }
      if (env.ORBIT_PROVIDER_API_KEY_PREFIX !== undefined) {
        defaultProviderConfig.apiKeyPrefix = env.ORBIT_PROVIDER_API_KEY_PREFIX;
      }
      const requestTimeoutMs = Number(env.ORBIT_PROVIDER_REQUEST_TIMEOUT_MS);
      if (Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0) {
        defaultProviderConfig.requestTimeoutMs = requestTimeoutMs;
      }
      const streamTimeoutMs = Number(env.ORBIT_PROVIDER_STREAM_TIMEOUT_MS);
      if (Number.isFinite(streamTimeoutMs) && streamTimeoutMs > 0) {
        defaultProviderConfig.streamTimeoutMs = streamTimeoutMs;
      }
      const maxRetries = Number(env.ORBIT_PROVIDER_MAX_RETRIES);
      if (Number.isFinite(maxRetries) && maxRetries >= 0) {
        defaultProviderConfig.maxRetries = maxRetries;
      }
    }

    const maxIterations = Number(
      env.ORBIT_AGENT_MAX_ITERATIONS || env.ORBIT_MAX_ITERATIONS,
    );
    if (Number.isFinite(maxIterations) && maxIterations > 0) {
      nextConfig.agent = {
        ...(nextConfig.agent || {}),
        maxIterations,
      };
    }

    const webSearch = nextConfig.tools?.webSearch;
    if (webSearch) {
      if (env.ORBIT_WEB_SEARCH_ENABLED) {
        webSearch.enabled =
          env.ORBIT_WEB_SEARCH_ENABLED.toLowerCase() !== "false" &&
          env.ORBIT_WEB_SEARCH_ENABLED !== "0";
      }
      const provider = env.ORBIT_WEB_SEARCH_PROVIDER;
      if (
        provider === "auto" ||
        provider === "searxng" ||
        provider === "tavily" ||
        provider === "bing" ||
        provider === "duckduckgo"
      ) {
        webSearch.provider = provider;
      }
      const searxngUrls = env.ORBIT_SEARXNG_URL || env.SEARXNG_URL;
      if (searxngUrls) {
        webSearch.searxngUrls = searxngUrls
          .split(",")
          .map((url) => url.trim())
          .filter(Boolean);
      }
      if (env.ORBIT_TAVILY_API_URL) {
        webSearch.tavilyBaseUrl = env.ORBIT_TAVILY_API_URL;
      }
      const timeoutMs = Number(env.ORBIT_WEB_SEARCH_TIMEOUT_MS);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        webSearch.timeoutMs = timeoutMs;
      }
      const maxResults = Number(env.ORBIT_WEB_SEARCH_MAX_RESULTS);
      if (Number.isFinite(maxResults) && maxResults > 0) {
        webSearch.maxResults = maxResults;
      }
    }

    if (nextConfig.skills) {
      if (env.ORBIT_SKILLS_ENABLED) {
        nextConfig.skills.enabled =
          env.ORBIT_SKILLS_ENABLED.toLowerCase() !== "false" &&
          env.ORBIT_SKILLS_ENABLED !== "0";
      }
      if (env.ORBIT_SKILLS_DIRS || env.ORBIT_SKILLS_DIR) {
        const raw = env.ORBIT_SKILLS_DIRS || env.ORBIT_SKILLS_DIR || "";
        nextConfig.skills.directories = raw
          .split(/[;,]/)
          .map((dir) => dir.trim())
          .filter(Boolean);
      }
      if (
        env.ORBIT_SKILLS_ACTIVATION === "explicit" ||
        env.ORBIT_SKILLS_ACTIVATION === "auto"
      ) {
        nextConfig.skills.activation = env.ORBIT_SKILLS_ACTIVATION;
      }
      const maxActive = Number(env.ORBIT_SKILLS_MAX_ACTIVE);
      if (Number.isFinite(maxActive) && maxActive >= 0) {
        nextConfig.skills.maxActive = maxActive;
      }
      const maxSkillBytes = Number(env.ORBIT_SKILLS_MAX_BYTES);
      if (Number.isFinite(maxSkillBytes) && maxSkillBytes > 0) {
        nextConfig.skills.maxSkillBytes = maxSkillBytes;
      }
      const maxAutoSkillBytes = Number(env.ORBIT_SKILLS_MAX_AUTO_BYTES);
      if (Number.isFinite(maxAutoSkillBytes) && maxAutoSkillBytes > 0) {
        nextConfig.skills.maxAutoSkillBytes = maxAutoSkillBytes;
      }
    }

    return nextConfig;
  }
}
