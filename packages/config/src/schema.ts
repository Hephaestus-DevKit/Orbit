import { z } from "zod";
import { OrbitLanguageSchema } from "./language.js";
import { AgentProfileSettingsSchema } from "./AgentProfiles.js";
import { LifecycleHooksSchema } from "./LifecycleHooks.js";

export {
  ORBIT_LIFECYCLE_HOOK_EVENTS,
  LifecycleHookCommandSchema,
  LifecycleHookEventSchema,
  LifecycleHooksSchema,
} from "./LifecycleHooks.js";

export const ORBIT_CONFIG_SCHEMA_VERSION = 1 as const;
export const DEFAULT_AGENT_MAX_ITERATIONS = 200;
export const MAX_AGENT_MAX_ITERATIONS = 1000;

const EnvironmentVariableNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
const HttpHeaderNameSchema = z
  .string()
  .max(256)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/);
const HttpHeaderValueSchema = z
  .string()
  .max(16_384)
  .refine((value) => !/[\r\n]/.test(value));
const HttpHeadersSchema = z
  .record(HttpHeaderNameSchema, HttpHeaderValueSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 200) {
      context.addIssue({
        code: "custom",
        message: "headers cannot contain more than 200 entries.",
      });
    }
  });

const ModelKindSchema = z.enum([
  "chat",
  "embedding",
  "image",
  "video",
  "audio",
  "search",
  "rerank",
  "unknown",
]);

const ModelCapabilitiesConfigSchema = z.object({
  streaming: z.boolean().optional(),
  toolCalls: z.boolean().optional(),
  jsonMode: z.boolean().optional(),
  thinking: z.boolean().optional(),
  vision: z.boolean().optional(),
  maxImages: z.number().int().positive().max(64).optional(),
  maxImageBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .optional(),
  promptCaching: z.boolean().optional(),
  maxContextTokens: z.number().int().positive().max(10_000_000).optional(),
  maxOutputTokens: z.number().int().positive().max(10_000_000).optional(),
  kind: ModelKindSchema.optional(),
  inputModalities: z.array(z.string().min(1).max(64)).max(16).optional(),
  outputModalities: z.array(z.string().min(1).max(64)).max(16).optional(),
  apiFormats: z
    .array(z.enum(["chat-completions", "responses", "anthropic"]))
    .max(4)
    .optional(),
  reasoningEfforts: z
    .array(z.enum(["low", "medium", "high", "xhigh", "max"]))
    .max(5)
    .optional(),
  parallelToolCalls: z.boolean().optional(),
  modelVersion: z.string().min(1).max(256).optional(),
  effectiveContextWindowPercent: z.number().positive().max(1).optional(),
});
const ModelCapabilitiesMapSchema = z
  .record(z.string().min(1).max(1024), ModelCapabilitiesConfigSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 1_000) {
      context.addIssue({
        code: "custom",
        message: "modelCapabilities cannot contain more than 1000 entries.",
      });
    }
  });
const ExtraBodySchema = z.record(z.unknown()).superRefine((value, context) => {
  if (Object.keys(value).length > 1_000) {
    context.addIssue({
      code: "custom",
      message: "extraBody cannot contain more than 1000 top-level entries.",
    });
  }
});

export const ProviderConfigSchema = z.object({
  type: z.enum([
    "openai",
    "anthropic",
    "openai-compatible",
    "anthropic-compatible",
    "deepseek",
    "ollama",
  ]),
  baseUrl: z.string().url().max(4096).optional(),
  apiKeyEnv: EnvironmentVariableNameSchema.optional(),
  apiKey: z.string().min(1).max(16384).optional(),
  apiKeyHeader: HttpHeaderNameSchema.optional(),
  apiKeyPrefix: z
    .string()
    .max(1024)
    .refine((value) => !/[\r\n]/.test(value))
    .optional(),
  headers: HttpHeadersSchema.optional(),
  models: z.array(z.string().min(1).max(1024)).max(1000).optional(),
  requestTimeoutMs: z.number().int().min(1000).max(600000).optional(),
  streamTimeoutMs: z.number().int().min(1000).max(600000).optional(),
  totalTimeoutMs: z.number().int().min(1000).max(900000).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  disablePreheat: z.boolean().optional(),
  deepSeekApiFormat: z
    .enum(["auto", "chat-completions", "responses", "anthropic"])
    .optional(),
  extraBody: ExtraBodySchema.optional(),
  capabilities: ModelCapabilitiesConfigSchema.optional(),
  modelCapabilities: ModelCapabilitiesMapSchema.optional(),
});

const ProvidersSchema = z
  .record(z.string().min(1).max(256), ProviderConfigSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 100) {
      context.addIssue({
        code: "custom",
        message: "providers cannot contain more than 100 entries.",
      });
    }
  });

export const McpServerConfigBaseSchema = z.object({
  transport: z.enum(["stdio", "streamable-http"]).default("stdio"),
  command: z.string().min(1).max(4096).optional(),
  args: z.array(z.string().max(20_000)).max(200).default([]),
  env: z
    .record(EnvironmentVariableNameSchema, z.string().max(100_000))
    .optional(),
  inheritEnv: z.array(EnvironmentVariableNameSchema).max(200).default([]),
  url: z.string().url().max(4096).optional(),
  headers: HttpHeadersSchema.default({}),
  bearerTokenEnv: EnvironmentVariableNameSchema.optional(),
  requestTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  recovery: z
    .object({
      enabled: z.boolean().default(true),
      maxAttempts: z.number().int().min(0).max(10).default(3),
      windowMs: z.number().int().min(1_000).max(3_600_000).default(60_000),
      initialBackoffMs: z.number().int().min(25).max(30_000).default(250),
      maxBackoffMs: z.number().int().min(25).max(120_000).default(4_000),
    })
    .refine((value) => value.maxBackoffMs >= value.initialBackoffMs, {
      message:
        "maxBackoffMs must be greater than or equal to initialBackoffMs.",
      path: ["maxBackoffMs"],
    })
    .default({}),
  oauth: z
    .object({
      mode: z
        .enum(["client_credentials", "authorization_code"])
        .default("client_credentials"),
      tokenUrl: z.string().url().max(4096),
      authorizationUrl: z.string().url().max(4096).optional(),
      clientIdEnv: EnvironmentVariableNameSchema,
      clientSecretEnv: EnvironmentVariableNameSchema.optional(),
      scope: z.string().max(1000).optional(),
      audience: z.string().max(1000).optional(),
    })
    .optional(),
  resources: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
  prompts: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
  interactions: z
    .object({
      /** Permit the server to request user input through form/URL elicitation. */
      elicitation: z.boolean().default(true),
      /** Permit the server to use the active host model for sampling. */
      sampling: z.boolean().default(true),
      /** Permit the server to ask for the workspace roots exposed by Orbit. */
      roots: z.boolean().default(true),
    })
    .default({ elicitation: true, sampling: true, roots: true }),
  tools: z
    .record(
      z.object({
        risk: z
          .enum(["read", "write", "execute", "dangerous", "network"])
          .default("execute"),
      }),
    )
    .default({}),
});

export const McpServerConfigSchema = McpServerConfigBaseSchema.superRefine(
  (value, context) => {
    for (const [path, collection, limit] of [
      ["env", value.env, 200],
      ["tools", value.tools, 1_000],
    ] as const) {
      if (collection && Object.keys(collection).length > limit) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `${path} cannot contain more than ${limit} entries.`,
        });
      }
    }
    if (value.transport === "stdio" && !value.command) {
      context.addIssue({
        code: "custom",
        path: ["command"],
        message: "stdio MCP servers require a command.",
      });
    }
    if (value.transport === "streamable-http" && !value.url) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "streamable-http MCP servers require a URL.",
      });
    }
    if (value.oauth) {
      if (
        value.oauth.mode === "client_credentials" &&
        !value.oauth.clientSecretEnv
      ) {
        context.addIssue({
          code: "custom",
          path: ["oauth", "clientSecretEnv"],
          message: "client_credentials OAuth requires clientSecretEnv.",
        });
      }
      if (
        value.oauth.mode === "authorization_code" &&
        !value.oauth.authorizationUrl
      ) {
        context.addIssue({
          code: "custom",
          path: ["oauth", "authorizationUrl"],
          message: "authorization_code OAuth requires authorizationUrl.",
        });
      }
    }
  },
);

/** External ACP agents are separate processes with their own auth and tools. */
export const ExternalAgentConfigSchema = z
  .object({
    command: z.string().trim().min(1).max(4_096),
    args: z.array(z.string().max(20_000)).max(200).default([]),
    env: z
      .record(EnvironmentVariableNameSchema, z.string().max(100_000))
      .default({}),
    inheritEnv: z.array(EnvironmentVariableNameSchema).max(200).default([]),
    enabled: z.boolean().default(true),
    requestTimeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(600_000),
    permissionPolicy: z.enum(["ask", "deny"]).default("ask"),
  })
  .strict();

const ExternalAgentsSchema = z
  .record(z.string().min(1).max(256), ExternalAgentConfigSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 100) {
      context.addIssue({
        code: "custom",
        message: "externalAgents cannot contain more than 100 entries.",
      });
    }
  });

const McpServersSchema = z
  .record(z.string().min(1).max(256), McpServerConfigSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 100) {
      context.addIssue({
        code: "custom",
        message: "mcpServers cannot contain more than 100 entries.",
      });
    }
  });

const ModelRateSchema = z.object({
  inputCostPer1M: z.number().finite().nonnegative().default(0),
  outputCostPer1M: z.number().finite().nonnegative().default(0),
  cacheReadCostPer1M: z.number().finite().nonnegative().optional(),
});

export const ModelPriceSchema = ModelRateSchema.extend({
  scheduled: z
    .object({
      effectiveAt: z.string().datetime({ offset: true }),
      peakHoursUtc: z
        .array(z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/))
        .max(24),
      peak: ModelRateSchema,
      offPeak: ModelRateSchema,
    })
    .optional(),
});

export const PricingTableSchema = z
  .record(z.string().min(1).max(1024), ModelPriceSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 10_000) {
      context.addIssue({
        code: "custom",
        message: "pricing cannot contain more than 10000 entries.",
      });
    }
  });

export const ConfigSchema = z.object({
  schemaVersion: z.literal(ORBIT_CONFIG_SCHEMA_VERSION).default(1),
  name: z.string().min(1).max(256).default("orbit-project"),
  editor: z.string().min(1).max(4096).default("notepad.exe"),
  autoCommit: z.boolean().default(false),
  language: OrbitLanguageSchema.default("en"),
  security: z
    .object({
      trustProjectExecutables: z.boolean().default(false),
      encryptCheckpoints: z.boolean().default(true),
      extensionTrustRoots: z
        .record(z.string().min(1).max(16_384))
        .refine((value) => Object.keys(value).length <= 50, {
          message: "extensionTrustRoots cannot contain more than 50 keys.",
        })
        .default({}),
      requireSignedAcpRegistry: z.boolean().default(false),
      acpRegistryTrustRoots: z
        .record(z.string().min(1).max(16_384))
        .refine((value) => Object.keys(value).length <= 50, {
          message: "acpRegistryTrustRoots cannot contain more than 50 keys.",
        })
        .default({}),
      /** Ed25519 roots used only to authenticate the Windows sandbox helper. */
      windowsSandboxTrustRoots: z
        .record(z.string().min(1).max(16_384))
        .refine((value) => Object.keys(value).length <= 50, {
          message: "windowsSandboxTrustRoots cannot contain more than 50 keys.",
        })
        .default({}),
    })
    .default({}),
  provider: z
    .object({
      default: z.string().min(1).max(256).default("deepseek"),
      embedding: z.string().min(1).max(256).optional(),
    })
    .default({}),
  models: z
    .object({
      default: z.string().min(1).max(1024).default("deepseek-v4-flash"),
      fast: z.string().min(1).max(1024).default("deepseek-v4-flash"),
      planner: z.string().min(1).max(1024).default("deepseek-v4-pro"),
      coder: z.string().min(1).max(1024).default("deepseek-v4-pro"),
      reviewer: z.string().min(1).max(1024).default("deepseek-v4-pro"),
      summarizer: z.string().min(1).max(1024).default("deepseek-v4-flash"),
      embedding: z.string().min(1).max(1024).default("text-embedding-3-small"),
    })
    .default({}),
  providers: ProvidersSchema.default({}),
  permissions: z
    .object({
      mode: z.enum(["strict", "normal", "auto", "plan"]).default("normal"),
      allowRead: z.boolean().default(true),
      requireApprovalForWrite: z.boolean().default(true),
      requireApprovalForBash: z.boolean().default(true),
      blockDangerousCommands: z.boolean().default(true),
      protectSecrets: z.boolean().default(true),
      protectedPaths: z
        .array(z.string().min(1).max(4096))
        .max(1000)
        .default([
          ".env",
          ".env.*",
          ".git/**",
          ".orbit/**",
          ".npmrc",
          ".pypirc",
          ".netrc",
          "id_rsa",
          "id_ed25519",
          ".ssh/**",
          ".gnupg/**",
          ".aws/**",
          ".azure/**",
          ".config/gcloud/**",
          ".kube/**",
          "**/*.{key,pem,p12,pfx}",
          "**/*secret*",
          "**/*token*",
          "**/*credential*",
        ]),
    })
    .default({}),
  context: z
    .object({
      maxFilesToIndex: z.number().int().min(1).max(100_000).default(5000),
      maxFileSizeKb: z.number().int().min(1).max(102_400).default(512),
      autoCodebaseRetrieval: z.boolean().default(true),
      ignore: z
        .array(z.string().min(1).max(4096))
        .max(2000)
        .default([
          "node_modules/**",
          "dist/**",
          "build/**",
          ".git/**",
          "coverage/**",
          ".next/**",
          ".turbo/**",
          "**/AppData/**",
          "**/Local Settings/**",
          "**/Downloads/**",
          "**/Documents/**",
          "**/Pictures/**",
          "**/Music/**",
          "**/Videos/**",
          "**/.npm/**",
          "**/.cargo/**",
          "**/.gradle/**",
          "**/.rustup/**",
          "**/.orbit/**",
        ]),
      autoCompact: z.boolean().default(true),
      compactThreshold: z.number().finite().min(0.1).max(1).default(0.75),
      autoRepair: z.boolean().default(false),
      maxRepairAttempts: z.number().int().min(0).max(10).default(3),
      testCommands: z.array(z.string().max(20_000)).max(100).default([]),
    })
    .default({}),
  agent: z
    .object({
      maxIterations: z
        .number()
        .int()
        .min(1)
        .max(MAX_AGENT_MAX_ITERATIONS)
        .default(DEFAULT_AGENT_MAX_ITERATIONS),
      fastMaxOutputTokens: z.number().int().min(256).max(384000).default(32768),
      maxOutputTokens: z.number().int().min(256).max(384000).default(16384),
      teamPreset: z.enum(["fast", "balanced", "thorough"]).default("balanced"),
      maxReviewAttempts: z.number().int().min(1).max(10).default(3),
      maxReviewConcurrency: z.number().int().min(1).max(8).default(2),
    })
    .default({}),
  agents: AgentProfileSettingsSchema,
  externalAgents: ExternalAgentsSchema.default({}),
  autocomplete: z
    .object({
      enabled: z.boolean().default(true),
      provider: z.string().min(1).max(256).default("ollama"),
      model: z.string().min(1).max(1024).default("qwen2.5-coder:1.5b"),
      debounceMs: z.number().int().min(0).max(10_000).default(150),
      speculative: z
        .object({
          enabled: z.boolean().default(false),
          provider: z.string().min(1).max(256).default("ollama"),
          model: z.string().min(1).max(1024).default("qwen2.5-coder:0.5b"),
          timeoutMs: z.number().int().min(0).max(10_000).default(150),
        })
        .optional(),
    })
    .default({}),
  tui: z
    .object({
      mouse: z.boolean().default(true),
      scrollSpeed: z.number().int().min(1).max(100).default(50),
      color: z.enum(["auto", "always", "never"]).default("auto"),
      theme: z.enum(["morandi", "high-contrast", "plain"]).default("morandi"),
      keymap: z.enum(["standard", "vim"]).default("standard"),
      accessibility: z.enum(["standard", "screen-reader"]).default("standard"),
    })
    .default({}),
  tools: z
    .object({
      bash: z
        .object({
          enabled: z.boolean().default(true),
          timeoutMs: z.number().int().min(1000).max(600_000).default(120000),
          sandbox: z.enum(["off", "auto", "required"]).default("auto"),
          network: z.enum(["inherit", "deny", "allow"]).default("inherit"),
        })
        .default({}),
      backgroundTasks: z
        .object({
          maxConcurrentTasks: z.number().int().min(1).max(32).default(8),
          maxRetainedTasks: z.number().int().min(1).max(256).default(64),
          maxOutputBytes: z
            .number()
            .int()
            .min(16 * 1024)
            .max(16 * 1024 * 1024)
            .default(1024 * 1024),
          terminateGraceMs: z
            .number()
            .int()
            .min(100)
            .max(30_000)
            .default(2_000),
          awaitOnCompletion: z.boolean().default(true),
          completionWaitMs: z
            .number()
            .int()
            .min(1_000)
            .max(30_000)
            .default(30_000),
        })
        .refine((value) => value.maxRetainedTasks >= value.maxConcurrentTasks, {
          message:
            "maxRetainedTasks must be greater than or equal to maxConcurrentTasks.",
          path: ["maxRetainedTasks"],
        })
        .default({}),
      webSearch: z
        .object({
          enabled: z.boolean().default(true),
          provider: z
            .enum(["auto", "searxng", "tavily", "bing", "duckduckgo"])
            .default("auto"),
          searxngUrls: z.array(z.string().url().max(4096)).max(20).default([]),
          tavilyApiKeyEnv:
            EnvironmentVariableNameSchema.default("TAVILY_API_KEY"),
          tavilyBaseUrl: z
            .string()
            .url()
            .max(4096)
            .default("https://api.tavily.com/search"),
          timeoutMs: z.number().int().min(1000).max(30000).default(8000),
          maxResults: z.number().int().min(1).max(20).default(8),
        })
        .default({}),
      mcp: z
        .object({
          enabled: z.boolean().default(false),
        })
        .default({}),
    })
    .default({}),
  skills: z
    .object({
      enabled: z.boolean().default(true),
      directories: z
        .array(z.string().min(1).max(4096))
        .max(50)
        .default([
          ".orbit/skills",
          ".agents/skills",
          ".claude/skills",
          "~/.claude/skills",
          "~/.orbit/skills",
        ]),
      activation: z.enum(["explicit", "auto"]).default("auto"),
      maxActive: z.number().int().min(0).max(8).default(3),
      disabled: z
        .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/))
        .max(200)
        .default([]),
      maxSkillBytes: z.number().int().min(512).max(200000).default(32768),
      maxAutoSkillBytes: z.number().int().min(512).max(200000).default(8000),
    })
    .default({}),
  mcpServers: McpServersSchema.default({}),
  managedPolicy: z
    .object({
      allowedProviders: z
        .array(z.string().min(1).max(1024))
        .max(1000)
        .optional(),
      allowedModels: z.array(z.string().min(1).max(1024)).max(1000).optional(),
      minimumPermissionMode: z
        .enum(["auto", "normal", "strict", "plan"])
        .optional(),
      requireWriteApproval: z.boolean().default(false),
      requireBashApproval: z.boolean().default(false),
      disableWebSearch: z.boolean().default(false),
      disableMcp: z.boolean().default(false),
      disableExternalAgents: z.boolean().default(false),
      disableExtensionHooks: z.boolean().default(false),
      disableExtensionTools: z.boolean().default(false),
      allowedExtensions: z
        .array(z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/))
        .max(500)
        .optional(),
      extensionTrustRoots: z
        .record(z.string().min(1).max(16_384))
        .refine((value) => Object.keys(value).length <= 50, {
          message: "extensionTrustRoots cannot contain more than 50 keys.",
        })
        .optional(),
      requireSignedAcpRegistry: z.boolean().default(false),
      acpRegistryTrustRoots: z
        .record(z.string().min(1).max(16_384))
        .refine((value) => Object.keys(value).length <= 50, {
          message: "acpRegistryTrustRoots cannot contain more than 50 keys.",
        })
        .optional(),
      windowsSandboxTrustRoots: z
        .record(z.string().min(1).max(16_384))
        .refine((value) => Object.keys(value).length <= 50, {
          message: "windowsSandboxTrustRoots cannot contain more than 50 keys.",
        })
        .optional(),
      maxIterations: z
        .number()
        .int()
        .positive()
        .max(MAX_AGENT_MAX_ITERATIONS)
        .optional(),
    })
    .optional(),
  hooks: z
    .object({
      /** @deprecated Use lifecycle.preToolUse with a write-tool matcher. */
      preEdit: z.string().max(20_000).optional(),
      /** @deprecated Use lifecycle.postToolUse with a write-tool matcher. */
      postEdit: z.string().max(20_000).optional(),
      lifecycle: LifecycleHooksSchema.optional(),
    })
    .strict()
    .default({}),
  pricing: PricingTableSchema.default({}),
  budgetLimit: z.number().finite().nonnegative().default(10.0),
  session: z
    .object({
      store: z.enum(["sqlite", "jsonl"]).default("jsonl"),
      path: z.string().min(1).max(4096).default(".orbit/sessions"),
    })
    .default({}),
});

export type OrbitConfig = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProviderType = ProviderConfig["type"];
