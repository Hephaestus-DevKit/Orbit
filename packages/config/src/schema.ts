import { z } from "zod";
import { OrbitLanguageSchema } from "./language.js";

export const ORBIT_CONFIG_SCHEMA_VERSION = 1 as const;

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
  promptCaching: z.boolean().optional(),
  maxContextTokens: z.number().int().positive().max(10_000_000).optional(),
  maxOutputTokens: z.number().int().positive().max(10_000_000).optional(),
  kind: ModelKindSchema.optional(),
  inputModalities: z.array(z.string().min(1).max(64)).max(16).optional(),
  outputModalities: z.array(z.string().min(1).max(64)).max(16).optional(),
});

export const ProviderConfigSchema = z.object({
  type: z.enum([
    "openai",
    "anthropic",
    "openai-compatible",
    "anthropic-compatible",
    "ollama",
  ]),
  baseUrl: z.string().url().max(4096).optional(),
  apiKeyEnv: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/)
    .optional(),
  apiKey: z.string().min(1).max(16384).optional(),
  apiKeyHeader: z
    .string()
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
    .optional(),
  apiKeyPrefix: z
    .string()
    .max(1024)
    .refine((value) => !/[\r\n]/.test(value))
    .optional(),
  headers: z
    .record(
      z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
      z
        .string()
        .max(16384)
        .refine((value) => !/[\r\n]/.test(value)),
    )
    .optional(),
  models: z.array(z.string().min(1).max(1024)).max(1000).optional(),
  requestTimeoutMs: z.number().int().min(1000).max(600000).optional(),
  streamTimeoutMs: z.number().int().min(1000).max(600000).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  disablePreheat: z.boolean().optional(),
  extraBody: z.record(z.unknown()).optional(),
  capabilities: ModelCapabilitiesConfigSchema.optional(),
  modelCapabilities: z.record(ModelCapabilitiesConfigSchema).optional(),
});

export const McpServerConfigBaseSchema = z.object({
  transport: z.enum(["stdio", "streamable-http"]).default("stdio"),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  inheritEnv: z.array(z.string()).default([]),
  url: z.string().url().optional(),
  headers: z.record(z.string()).default({}),
  bearerTokenEnv: z.string().min(1).max(200).optional(),
  requestTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  oauth: z
    .object({
      mode: z
        .enum(["client_credentials", "authorization_code"])
        .default("client_credentials"),
      tokenUrl: z.string().url(),
      authorizationUrl: z.string().url().optional(),
      clientIdEnv: z.string().min(1).max(200),
      clientSecretEnv: z.string().min(1).max(200).optional(),
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

export const ModelPriceSchema = z.object({
  inputCostPer1M: z.number().finite().nonnegative().default(0),
  outputCostPer1M: z.number().finite().nonnegative().default(0),
  cacheReadCostPer1M: z.number().finite().nonnegative().optional(),
});

export const PricingTableSchema = z.record(ModelPriceSchema);

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
    })
    .default({}),
  provider: z
    .object({
      default: z.string().min(1).max(256).default("deepseek-openai"),
      embedding: z.string().min(1).max(256).optional(),
    })
    .default({}),
  models: z
    .object({
      default: z.string().default("deepseek-v4-flash"),
      fast: z.string().default("deepseek-v4-flash"),
      planner: z.string().default("deepseek-v4-pro"),
      coder: z.string().default("deepseek-v4-pro"),
      reviewer: z.string().default("deepseek-v4-pro"),
      summarizer: z.string().default("deepseek-v4-flash"),
      embedding: z.string().default("text-embedding-3-small"),
    })
    .default({}),
  providers: z.record(ProviderConfigSchema).default({}),
  permissions: z
    .object({
      mode: z.enum(["strict", "normal", "auto", "plan"]).default("normal"),
      allowRead: z.boolean().default(true),
      requireApprovalForWrite: z.boolean().default(true),
      requireApprovalForBash: z.boolean().default(true),
      blockDangerousCommands: z.boolean().default(true),
      protectSecrets: z.boolean().default(true),
      protectedPaths: z
        .array(z.string())
        .default([
          ".env",
          ".env.*",
          "id_rsa",
          "id_ed25519",
          ".ssh/**",
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
      ignore: z
        .array(z.string())
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
      testCommands: z.array(z.string()).default([]),
    })
    .default({}),
  agent: z
    .object({
      maxIterations: z.number().int().min(1).max(50).default(24),
      fastMaxOutputTokens: z.number().int().min(256).max(384000).default(8192),
      maxOutputTokens: z.number().int().min(256).max(384000).default(16384),
    })
    .default({}),
  autocomplete: z
    .object({
      enabled: z.boolean().default(true),
      provider: z.string().default("ollama"),
      model: z.string().default("qwen2.5-coder:1.5b"),
      debounceMs: z.number().int().min(0).max(10_000).default(150),
      speculative: z
        .object({
          enabled: z.boolean().default(false),
          provider: z.string().default("ollama"),
          model: z.string().default("qwen2.5-coder:0.5b"),
          timeoutMs: z.number().default(150),
        })
        .optional(),
    })
    .default({}),
  tui: z
    .object({
      mouse: z.boolean().default(true),
      scrollSpeed: z.number().int().min(1).max(100).default(50),
    })
    .default({}),
  tools: z
    .object({
      bash: z
        .object({
          enabled: z.boolean().default(true),
          timeoutMs: z.number().int().min(1000).max(600_000).default(120000),
        })
        .default({}),
      webSearch: z
        .object({
          enabled: z.boolean().default(true),
          provider: z
            .enum(["auto", "searxng", "tavily", "bing", "duckduckgo"])
            .default("auto"),
          searxngUrls: z.array(z.string()).default([]),
          tavilyApiKeyEnv: z.string().default("TAVILY_API_KEY"),
          tavilyBaseUrl: z.string().default("https://api.tavily.com/search"),
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
        .array(z.string())
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
      maxSkillBytes: z.number().int().min(512).max(200000).default(24000),
      maxAutoSkillBytes: z.number().int().min(512).max(200000).default(8000),
    })
    .default({}),
  mcpServers: z.record(McpServerConfigSchema).default({}),
  managedPolicy: z
    .object({
      allowedProviders: z.array(z.string()).optional(),
      allowedModels: z.array(z.string()).optional(),
      minimumPermissionMode: z
        .enum(["auto", "normal", "strict", "plan"])
        .optional(),
      disableWebSearch: z.boolean().default(false),
      disableMcp: z.boolean().default(false),
    })
    .optional(),
  hooks: z
    .object({
      preEdit: z.string().optional(),
      postEdit: z.string().optional(),
    })
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
