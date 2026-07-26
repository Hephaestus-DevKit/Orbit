import { promises as fs } from "fs";
import { join, relative, resolve } from "path";
import { resolveSafePath } from "@orbit-build/shared";
import { stringify as stringifyYaml } from "yaml";

export interface CreateSkillRequest {
  kind: "skill";
  name: string;
  description: string;
  instructions: string;
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

export interface CreatedCapability {
  kind: CreateCapabilityRequest["kind"];
  name: string;
  path: string;
}

/** Create a project-local Skill or prompt workflow without overwriting files. */
export async function createProjectCapability(
  cwd: string,
  request: CreateCapabilityRequest,
): Promise<CreatedCapability> {
  const workspace = await fs.realpath(resolve(cwd));
  if (request.kind === "skill") {
    const skillsDirectory = await ensureSafeDirectory(
      workspace,
      ".orbit",
      "skills",
    );
    const skillDirectory = await ensureSafeDirectory(
      workspace,
      relative(workspace, skillsDirectory),
      request.name,
    );
    await ensureSafeDirectory(
      workspace,
      relative(workspace, skillDirectory),
      "agents",
    );
    const skillPath = join(skillDirectory, "SKILL.md");
    const presentationPath = join(skillDirectory, "agents", "openai.yaml");
    await writeSkillFiles(skillPath, presentationPath, request);
    return {
      kind: request.kind,
      name: request.name,
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
    resolve(commandsDirectory, `${request.name}.md`),
  );
  const skillPrompt = request.skills.map((name) => `Use $${name}.`).join(" ");
  await writeExclusive(
    workflowPath,
    [
      "---",
      stringifyYaml({
        description: request.description.trim(),
        "argument-hint":
          request.argumentHint?.trim() || "[input or requirements]",
      }).trimEnd(),
      "---",
      "",
      skillPrompt,
      request.instructions.trim(),
      "",
      "Apply the workflow to $ARGUMENTS.",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return {
    kind: request.kind,
    name: request.name,
    path: normalizePath(relative(workspace, workflowPath)),
  };
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
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
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
        default_prompt: `Use $${request.name} to `,
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
