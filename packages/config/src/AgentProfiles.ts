import { homedir } from "os";
import { existsSync, lstatSync, readdirSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { parse } from "yaml";
import { z } from "zod";
import {
  readBoundedRegularFile,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";
import type { OrbitConfig } from "./schema.js";
import { LifecycleHooksSchema } from "./LifecycleHooks.js";
import { validateManagedRuntimeChange } from "./ManagedPolicy.js";

export const AGENT_PROFILE_SCHEMA_VERSION = 1 as const;
export const MAX_AGENT_PROFILE_FILE_BYTES = 128 * 1024;
export const MAX_AGENT_PROFILES = 100;

const ProfileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const ToolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_:-]*$/);

const SkillNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const McpServerNameSchema = z.string().trim().min(1).max(256);

/** User-authored, provider-neutral Agent Profile contract. */
export const AgentProfileSchema = z
  .object({
    schemaVersion: z.literal(AGENT_PROFILE_SCHEMA_VERSION).default(1),
    name: ProfileNameSchema,
    /** Optional parent profile resolved from the same discovered catalog. */
    extends: ProfileNameSchema.optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2_000).default(""),
    provider: z.string().trim().min(1).max(256).optional(),
    model: z.string().trim().min(1).max(1_024).optional(),
    permissionMode: z.enum(["strict", "normal", "auto", "plan"]).optional(),
    allowedTools: z.array(ToolNameSchema).max(256).optional(),
    disallowedTools: z.array(ToolNameSchema).max(256).default([]),
    skills: z.array(SkillNameSchema).max(32).default([]),
    maxTurns: z.number().int().min(1).max(1_000).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    systemPrompt: z.string().trim().max(20_000).optional(),
    isolation: z.enum(["workspace", "worktree"]).default("workspace"),
    memory: z.enum(["project", "none"]).default("project"),
    /** Restrict this profile to named MCP servers; omitted means all configured servers. */
    mcpServers: z.array(McpServerNameSchema).max(100).optional(),
    /** Additional lifecycle hooks owned by this profile's agent role. */
    hooks: LifecycleHooksSchema.optional(),
  })
  .superRefine((profile, context) => {
    const allowed = new Set(profile.allowedTools ?? []);
    for (const tool of profile.disallowedTools) {
      if (allowed.has(tool)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["disallowedTools"],
          message: `Tool ${tool} cannot be both allowed and disallowed.`,
        });
      }
    }
  });

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

/** Configuration for profile discovery; project directories are first. */
export const AgentProfileSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    directories: z
      .array(z.string().trim().min(1).max(4_096))
      .max(20)
      .default([
        ".agents/agents",
        ".orbit/agents",
        ".claude/agents",
        "~/.orbit/agents",
        "~/.claude/agents",
      ]),
    defaultProfile: ProfileNameSchema.optional(),
    maxProfiles: z.number().int().min(1).max(MAX_AGENT_PROFILES).default(32),
  })
  .default({});

export type AgentProfileSettings = z.infer<typeof AgentProfileSettingsSchema>;

export interface AgentProfileDiagnostic {
  path: string;
  severity: "warning" | "error";
  code: string;
  message: string;
}

export interface RegisteredAgentProfile extends AgentProfile {
  path: string;
  source: "project" | "user";
  /** Fields explicitly authored in the manifest, excluding schema defaults. */
  declaredFields?: readonly string[];
}

export interface AgentProfileCatalog {
  profiles: RegisteredAgentProfile[];
  diagnostics: AgentProfileDiagnostic[];
  directories: string[];
}

/** Resolve profile directories with stable first-directory-wins precedence. */
export function resolveAgentProfileDirectories(
  cwd: string,
  directories: string[],
): string[] {
  const resolved = new Map<string, string>();
  for (const directory of directories) {
    const trimmed = directory.trim();
    if (!trimmed) continue;
    const expanded =
      trimmed === "~"
        ? homedir()
        : trimmed.startsWith("~/") || trimmed.startsWith("~\\")
          ? join(homedir(), trimmed.slice(2))
          : trimmed;
    const absolute = isAbsolute(expanded)
      ? resolve(expanded)
      : resolve(cwd, expanded);
    const key =
      process.platform === "win32" ? absolute.toLowerCase() : absolute;
    if (!resolved.has(key)) resolved.set(key, absolute);
  }
  return [...resolved.values()];
}

/** Discover YAML/JSON profiles without executing profile-provided content. */
export function discoverAgentProfiles(
  cwd: string,
  settings: AgentProfileSettings,
): AgentProfileCatalog {
  const directories = resolveAgentProfileDirectories(cwd, settings.directories);
  const diagnostics: AgentProfileDiagnostic[] = [];
  const loaded: RegisteredAgentProfile[] = [];
  const maxProfiles = Math.min(MAX_AGENT_PROFILES, settings.maxProfiles);

  for (const directory of directories) {
    if (!existsSync(directory)) continue;
    if (isProjectProfile(cwd, directory)) {
      try {
        resolveSafePath(cwd, directory);
      } catch {
        diagnostics.push({
          path: normalizeDiagnosticPath(directory),
          severity: "error",
          code: "unsafe-directory",
          message: "Agent profile directory escapes the project boundary.",
        });
        continue;
      }
    }
    let filePaths: string[];
    try {
      const stats = lstatSync(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        diagnostics.push({
          path: normalizeDiagnosticPath(directory),
          severity: "error",
          code: "unsafe-directory",
          message:
            "Agent profile roots must be regular directories, not files or symbolic links.",
        });
        continue;
      }
      filePaths = collectAgentProfileFiles(directory, diagnostics);
    } catch (error: unknown) {
      diagnostics.push({
        path: normalizeDiagnosticPath(directory),
        severity: "warning",
        code: "unreadable-directory",
        message: `Agent profile directory could not be read: ${safeMessage(error)}`,
      });
      continue;
    }
    for (const filePath of filePaths) {
      if (loaded.length >= maxProfiles) {
        diagnostics.push({
          path: normalizeDiagnosticPath(directory),
          severity: "warning",
          code: "discovery-limit",
          message: `Agent profile discovery stopped after ${maxProfiles} profiles.`,
        });
        break;
      }
      try {
        const raw = readBoundedRegularFile(
          filePath,
          MAX_AGENT_PROFILE_FILE_BYTES,
        );
        if (raw === undefined) {
          diagnostics.push({
            path: normalizeDiagnosticPath(filePath),
            severity: "warning",
            code: "unreadable-profile",
            message:
              "Agent Profile was ignored because it is oversized, missing, or no longer a regular file.",
          });
          continue;
        }
        const document = parse(raw);
        const declaredFields = isRecord(document)
          ? Object.keys(document)
          : ([] as string[]);
        const parsed = AgentProfileSchema.safeParse(document);
        if (!parsed.success) {
          diagnostics.push({
            path: normalizeDiagnosticPath(filePath),
            severity: "error",
            code: "invalid-profile",
            message: formatProfileIssues(parsed.error),
          });
          continue;
        }
        const profile = parsed.data;
        const duplicate = loaded.find(
          (candidate) =>
            candidate.name.toLowerCase() === profile.name.toLowerCase(),
        );
        if (duplicate) {
          diagnostics.push({
            path: normalizeDiagnosticPath(filePath),
            severity: "warning",
            code: "duplicate-profile",
            message: `Profile "${profile.name}" ignored; using ${duplicate.path}.`,
          });
          continue;
        }
        loaded.push({
          ...profile,
          path: normalizeDiagnosticPath(filePath),
          source: isProjectProfile(cwd, directory) ? "project" : "user",
          declaredFields,
        });
      } catch (error: unknown) {
        diagnostics.push({
          path: normalizeDiagnosticPath(filePath),
          severity: "error",
          code: "read-error",
          message: redactSecrets(safeMessage(error)).slice(0, 2_000),
        });
      }
    }
  }

  return {
    profiles: loaded.sort((left, right) => left.name.localeCompare(right.name)),
    diagnostics,
    directories: directories.map(normalizeDiagnosticPath),
  };
}

/**
 * Collect direct profiles first, followed by one bounded extension namespace
 * level. This keeps user-authored files authoritative while preventing an
 * extension contribution from escaping its installer-owned directory.
 */
function collectAgentProfileFiles(
  directory: string,
  diagnostics: AgentProfileDiagnostic[],
): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  const files: string[] = [];
  for (const entry of entries) {
    if (!/\.(?:ya?ml|json)$/i.test(entry.name)) continue;
    const filePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      diagnostics.push({
        path: normalizeDiagnosticPath(filePath),
        severity: "warning",
        code: "unsafe-profile-file",
        message: "Symbolic-link Agent Profiles are ignored.",
      });
      continue;
    }
    if (entry.isFile()) files.push(filePath);
  }
  const extensionRoot = entries.find(
    (entry) => entry.name.toLowerCase() === "extensions",
  );
  if (!extensionRoot) return files;

  const extensionRootPath = join(directory, extensionRoot.name);
  if (extensionRoot.isSymbolicLink() || !extensionRoot.isDirectory()) {
    diagnostics.push({
      path: normalizeDiagnosticPath(extensionRootPath),
      severity: "warning",
      code: "unsafe-extension-directory",
      message:
        "Extension Agent Profiles were ignored because the extensions slot is not a regular directory.",
    });
    return files;
  }

  let namespaces;
  try {
    namespaces = readdirSync(extensionRootPath, {
      withFileTypes: true,
    }).sort((left, right) => left.name.localeCompare(right.name));
  } catch (error: unknown) {
    diagnostics.push({
      path: normalizeDiagnosticPath(extensionRootPath),
      severity: "warning",
      code: "unreadable-extension-directory",
      message: `Extension Agent Profile directory could not be read: ${safeMessage(error)}`,
    });
    return files;
  }

  for (const namespace of namespaces.slice(0, 500)) {
    const namespacePath = join(extensionRootPath, namespace.name);
    if (namespace.isSymbolicLink() || !namespace.isDirectory()) {
      diagnostics.push({
        path: normalizeDiagnosticPath(namespacePath),
        severity: "warning",
        code: "unsafe-extension-namespace",
        message:
          "Extension Agent Profile namespace was ignored because it is not a regular directory.",
      });
      continue;
    }
    try {
      const contributed = readdirSync(namespacePath, {
        withFileTypes: true,
      }).sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of contributed) {
        if (!/\.(?:ya?ml|json)$/i.test(entry.name)) continue;
        const filePath = join(namespacePath, entry.name);
        if (entry.isSymbolicLink()) {
          diagnostics.push({
            path: normalizeDiagnosticPath(filePath),
            severity: "warning",
            code: "unsafe-profile-file",
            message: "Symbolic-link Agent Profiles are ignored.",
          });
          continue;
        }
        if (entry.isFile()) files.push(filePath);
      }
    } catch (error: unknown) {
      diagnostics.push({
        path: normalizeDiagnosticPath(namespacePath),
        severity: "warning",
        code: "unreadable-extension-namespace",
        message: `Extension Agent Profile namespace could not be read: ${safeMessage(error)}`,
      });
    }
  }
  if (namespaces.length > 500) {
    diagnostics.push({
      path: normalizeDiagnosticPath(extensionRootPath),
      severity: "warning",
      code: "extension-namespace-limit",
      message:
        "Extension Agent Profile discovery stopped after 500 namespaces.",
    });
  }
  return files;
}

/** Resolve one profile and enforce managed policy before it reaches the loop. */
export function resolveAgentProfile(
  catalog: AgentProfileCatalog,
  name: string,
  config: OrbitConfig,
  options: {
    allowPermissionEscalation?: boolean;
    allowWorktreeIsolation?: boolean;
  } = {},
): RegisteredAgentProfile {
  const normalized = name.trim().toLowerCase();
  const profile = resolveInheritedProfile(catalog, normalized, []);
  if (profile.provider) {
    const violation = validateManagedRuntimeChange(config, {
      provider: profile.provider,
    });
    if (violation) throw new Error(violation);
  }
  if (profile.model) {
    const violation = validateManagedRuntimeChange(config, {
      model: profile.model,
    });
    if (violation) throw new Error(violation);
  }
  if (profile.permissionMode && !options.allowPermissionEscalation) {
    const current = permissionRank(config.permissions.mode);
    if (permissionRank(profile.permissionMode) < current) {
      throw new Error(
        `Agent profile ${profile.name} requests ${profile.permissionMode} mode; confirm Full Access explicitly before selecting it.`,
      );
    }
  }
  if (profile.maxTurns !== undefined) {
    const violation = validateManagedRuntimeChange(config, {
      agentMaxIterations: profile.maxTurns,
    });
    if (violation) throw new Error(violation);
  }
  if (profile.isolation === "worktree" && !options.allowWorktreeIsolation) {
    throw new Error(
      `Agent profile ${profile.name} requests worktree isolation, which must be selected through an isolated orchestration run.`,
    );
  }
  return profile;
}

/**
 * Resolve one profile's inheritance chain with deterministic child overrides.
 * Schema defaults are only applied when a field is not explicitly authored in
 * the child manifest, so inheritance remains useful without making defaults
 * ambiguous. Cycles and excessive depth fail closed before a profile reaches
 * the Agent runtime.
 */
function resolveInheritedProfile(
  catalog: AgentProfileCatalog,
  normalizedName: string,
  stack: string[],
): RegisteredAgentProfile {
  const profile = catalog.profiles.find(
    (candidate) => candidate.name.toLowerCase() === normalizedName,
  );
  if (!profile) throw new Error(`Agent profile not found: ${normalizedName}`);
  if (stack.includes(normalizedName)) {
    throw new Error(
      `Agent profile inheritance cycle detected: ${[...stack, normalizedName].join(" -> ")}.`,
    );
  }
  if (stack.length >= 8) {
    throw new Error(
      `Agent profile inheritance exceeds the maximum depth of 8: ${[...stack, normalizedName].join(" -> ")}.`,
    );
  }
  if (!profile.extends) return profile;

  const parent = resolveInheritedProfile(
    catalog,
    profile.extends.toLowerCase(),
    [...stack, normalizedName],
  );
  const childFields = new Set(profile.declaredFields ?? []);
  const inherited = {
    ...parent,
    ...profile,
    description: childFields.has("description")
      ? profile.description
      : parent.description,
    displayName: childFields.has("displayName")
      ? profile.displayName
      : parent.displayName,
    provider: childFields.has("provider") ? profile.provider : parent.provider,
    model: childFields.has("model") ? profile.model : parent.model,
    permissionMode: childFields.has("permissionMode")
      ? profile.permissionMode
      : parent.permissionMode,
    allowedTools: childFields.has("allowedTools")
      ? profile.allowedTools
      : parent.allowedTools,
    disallowedTools: childFields.has("disallowedTools")
      ? profile.disallowedTools
      : parent.disallowedTools,
    skills: childFields.has("skills") ? profile.skills : parent.skills,
    maxTurns: childFields.has("maxTurns") ? profile.maxTurns : parent.maxTurns,
    effort: childFields.has("effort") ? profile.effort : parent.effort,
    systemPrompt: childFields.has("systemPrompt")
      ? profile.systemPrompt
      : parent.systemPrompt,
    isolation: childFields.has("isolation")
      ? profile.isolation
      : parent.isolation,
    memory: childFields.has("memory") ? profile.memory : parent.memory,
    mcpServers: childFields.has("mcpServers")
      ? profile.mcpServers
      : parent.mcpServers,
    hooks: childFields.has("hooks") ? profile.hooks : parent.hooks,
    declaredFields: [
      ...new Set([
        ...(parent.declaredFields ?? []),
        ...(profile.declaredFields ?? []),
      ]),
    ],
  } satisfies RegisteredAgentProfile;
  return inherited;
}

function permissionRank(mode: OrbitConfig["permissions"]["mode"]): number {
  return { auto: 0, normal: 1, strict: 2, plan: 3 }[mode];
}

function isProjectProfile(cwd: string, directory: string): boolean {
  const projectRoots = [
    resolve(cwd, ".agents", "agents"),
    resolve(cwd, ".orbit", "agents"),
    resolve(cwd, ".claude", "agents"),
  ];
  const normalized = resolve(directory);
  return projectRoots.some((root) =>
    process.platform === "win32"
      ? root.toLowerCase() === normalized.toLowerCase()
      : root === normalized,
  );
}

function normalizeDiagnosticPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function formatProfileIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "profile"}: ${issue.message}`)
    .join("; ");
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
