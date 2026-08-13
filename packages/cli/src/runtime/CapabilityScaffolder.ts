import { promises as fs } from "fs";
import { dirname, join, relative, resolve } from "path";
import { randomUUID } from "crypto";
import { resolveSafePath } from "@orbit-build/shared";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

/**
 * Where a new skill lands: "local" keeps it out of version control under
 * `.orbit/skills` (the default, matching previous behavior); "versioned"
 * writes to `.agents/skills` so the skill ships with the repository.
 */
export type SkillScope = "local" | "versioned";

export interface CreateSkillRequest {
  kind: "skill";
  name: string;
  description: string;
  instructions: string;
  scope?: SkillScope;
}

export interface CreateWorkflowRequest {
  kind: "workflow";
  name: string;
  description: string;
  instructions: string;
  skills: string[];
  argumentHint?: string;
}

export type CreateCapabilityRequest =
  | CreateSkillRequest
  | CreateWorkflowRequest;

const CapabilityNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Capability names must be lowercase kebab-case.",
  );

const CreateCapabilityRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("skill"),
    name: CapabilityNameSchema,
    description: z.string().trim().min(1).max(2000),
    instructions: z.string().trim().min(1).max(24_000),
    scope: z.enum(["local", "versioned"]).default("local"),
  }),
  z.object({
    kind: z.literal("workflow"),
    name: CapabilityNameSchema,
    description: z.string().trim().min(1).max(240),
    instructions: z.string().trim().min(1).max(24_000),
    skills: z
      .array(CapabilityNameSchema)
      .max(8)
      .refine((skills) => new Set(skills).size === skills.length, {
        message: "Workflow Skill names must be unique.",
      }),
    argumentHint: z.string().trim().max(160).optional(),
  }),
]);

export interface CreatedCapability {
  kind: CreateCapabilityRequest["kind"];
  name: string;
  path: string;
}

const SKILL_BUNDLE_DIRECTORIES = [
  "agents",
  "references",
  "scripts",
  "assets",
] as const;

/** Create a project Skill or local prompt workflow without overwriting files. */
export async function createProjectCapability(
  cwd: string,
  request: CreateCapabilityRequest,
): Promise<CreatedCapability> {
  const workspace = await fs.realpath(resolve(cwd));
  const validated = CreateCapabilityRequestSchema.parse(request);
  if (validated.kind === "skill") {
    const rootSegments =
      validated.scope === "versioned"
        ? [".agents", "skills"]
        : [".orbit", "skills"];
    const skillsDirectory = await ensureSafeDirectory(
      workspace,
      ...rootSegments,
    );
    const skillDirectory = resolveSafePath(
      workspace,
      resolve(skillsDirectory, validated.name),
    );
    await assertMissing(skillDirectory);
    const stageDirectory = resolveSafePath(
      workspace,
      resolve(
        dirname(skillsDirectory),
        `.orbit-stage-${validated.name}-${randomUUID()}`,
      ),
    );
    let staged = false;
    try {
      await fs.mkdir(stageDirectory);
      staged = true;
      await Promise.all(
        SKILL_BUNDLE_DIRECTORIES.map((directory) =>
          fs.mkdir(join(stageDirectory, directory)),
        ),
      );
      await writeSkillFiles(
        join(stageDirectory, "SKILL.md"),
        join(stageDirectory, "agents", "openai.yaml"),
        validated,
      );
      await fs.rename(stageDirectory, skillDirectory);
      staged = false;
    } catch (error: unknown) {
      if (staged) {
        await fs
          .rm(stageDirectory, { recursive: true, force: true })
          .catch(() => undefined);
      }
      if (isAlreadyExists(error)) {
        throw new Error("A capability with this name already exists.");
      }
      throw error;
    }
    const skillPath = join(skillDirectory, "SKILL.md");
    return {
      kind: validated.kind,
      name: validated.name,
      path: normalizePath(relative(workspace, skillPath)),
    };
  }

  const commandsDirectory = await ensureSafeDirectory(
    workspace,
    ".orbit",
    "commands",
  );
  const workflowPath = resolveSafePath(
    workspace,
    resolve(commandsDirectory, `${validated.name}.md`),
  );
  const skillPrompt = validated.skills.map((name) => `Use $${name}.`).join(" ");
  await writeExclusive(
    workflowPath,
    [
      "---",
      stringifyYaml({
        description: validated.description,
        "argument-hint": validated.argumentHint || "[input or requirements]",
      }).trimEnd(),
      "---",
      "",
      skillPrompt,
      validated.instructions,
      "",
      "Apply the workflow to $ARGUMENTS.",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return {
    kind: validated.kind,
    name: validated.name,
    path: normalizePath(relative(workspace, workflowPath)),
  };
}

async function assertMissing(path: string): Promise<void> {
  try {
    await fs.lstat(path);
    throw new Error("A capability with this name already exists.");
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

async function ensureSafeDirectory(
  workspace: string,
  ...parts: string[]
): Promise<string> {
  const requested = resolveSafePath(workspace, resolve(workspace, ...parts));
  await fs.mkdir(requested, { recursive: true });
  const canonical = await fs.realpath(requested);
  return resolveSafePath(workspace, canonical);
}

async function writeExclusive(path: string, content: string): Promise<void> {
  try {
    await fs.writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error: unknown) {
    if (isAlreadyExists(error)) {
      throw new Error("A capability with this name already exists.");
    }
    throw error;
  }
}

async function writeSkillFiles(
  skillPath: string,
  presentationPath: string,
  request: CreateSkillRequest,
): Promise<void> {
  await writeExclusive(
    presentationPath,
    stringifyYaml({
      interface: {
        display_name: displayName(request.name),
        short_description: request.description.trim().slice(0, 200),
        default_prompt: `Use $${request.name} to complete this task.`,
      },
      policy: { allow_implicit_invocation: true },
    }),
  );
  try {
    await writeExclusive(
      skillPath,
      [
        "---",
        stringifyYaml({
          name: request.name,
          description: request.description.trim(),
        }).trimEnd(),
        "---",
        "",
        request.instructions.trim(),
        "",
      ].join("\n"),
    );
  } catch (error: unknown) {
    await fs.rm(presentationPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY")
  );
}

function displayName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
