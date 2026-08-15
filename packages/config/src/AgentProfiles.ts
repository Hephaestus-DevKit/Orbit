import { homedir } from "os";
import { existsSync, readdirSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { parse } from "yaml";
import { z } from "zod";
import {
  readBoundedRegularFile,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";
import type { OrbitConfig } from "./schema.js";
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

/** User-authored, provider-neutral Agent Profile contract. */
export const AgentProfileSchema = z
  .object({
    schemaVersion: z.literal(AGENT_PROFILE_SCHEMA_VERSION).default(1),
    name: ProfileNameSchema,
    displayName: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2_000).default(""),
    provider: z.string().trim().min(1).max(256).optional(),
    model: z.string().trim().min(1).max(1_024).optional(),
    permissionMode: z.enum(["strict", "normal", "auto", "plan"]).optional(),
    allowedTools: z.array(ToolNameSchema).max(256).optional(),
    disallowedTools: z.array(ToolNameSchema).max(256).default([]),
    skills: z.array(SkillNameSchema).max(32).default([]),
    maxTurns: z.number().int().min(1).max(1_000).optional(),
    systemPrompt: z.string().trim().max(20_000).optional(),
    isolation: z.enum(["workspace", "worktree"]).default("workspace"),
    memory: z.enum(["project", "none"]).default("project"),
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
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error: unknown) {
      diagnostics.push({
        path: normalizeDiagnosticPath(directory),
        severity: "warning",
        code: "unreadable-directory",
        message: `Agent profile directory could not be read: ${safeMessage(error)}`,
      });
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (loaded.length >= maxProfiles) {
        diagnostics.push({
          path: normalizeDiagnosticPath(directory),
          severity: "warning",
          code: "discovery-limit",
          message: `Agent profile discovery stopped after ${maxProfiles} profiles.`,
        });
        break;
      }
      if (!entry.isFile() || !/\.(?:ya?ml|json)$/i.test(entry.name)) continue;
      const filePath = join(directory, entry.name);
      try {
        const raw = readBoundedRegularFile(
          filePath,
          MAX_AGENT_PROFILE_FILE_BYTES,
        );
        if (raw === undefined) continue;
        const parsed = AgentProfileSchema.safeParse(parse(raw));
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

/** Resolve one profile and enforce managed policy before it reaches the loop. */
export function resolveAgentProfile(
  catalog: AgentProfileCatalog,
  name: string,
  config: OrbitConfig,
  options: { allowPermissionEscalation?: boolean } = {},
): RegisteredAgentProfile {
  const normalized = name.trim().toLowerCase();
  const profile = catalog.profiles.find(
    (candidate) => candidate.name.toLowerCase() === normalized,
  );
  if (!profile) throw new Error(`Agent profile not found: ${name}`);
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
  if (profile.isolation === "worktree") {
    throw new Error(
      `Agent profile ${profile.name} requests worktree isolation, which must be selected through an isolated orchestration run.`,
    );
  }
  return profile;
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
