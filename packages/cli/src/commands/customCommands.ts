import { existsSync, readdirSync, type Dirent } from "fs";
import { basename, extname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { parse } from "yaml";
import { z } from "zod";
import { isValidSkillName, readBoundedRegularFile } from "@orbit-build/shared";
import {
  WorkflowStagesSchema,
  type WorkflowStage,
} from "../runtime/workflows/WorkflowSchema.js";

export const CommandArgumentHintSchema = z.string().max(160);
export const CommandSkillsSchema = z
  .array(z.string().refine(isValidSkillName, "Invalid Skill name."))
  .max(8)
  .refine((skills) => new Set(skills).size === skills.length, {
    message: "Workflow Skill names must be unique.",
  });

const CommandMetadataSchema = z.object({
  description: z.string().max(240).optional(),
  argumentHint: CommandArgumentHintSchema.optional(),
  "argument-hint": CommandArgumentHintSchema.optional(),
  skills: CommandSkillsSchema.optional(),
  stages: WorkflowStagesSchema.optional(),
});

export interface CustomCommand {
  name: string;
  description: string;
  argumentHint?: string;
  skills?: string[];
  stages?: WorkflowStage[];
  template: string;
  source: "builtin" | "user" | "project";
  filePath: string;
}

export interface LoadCustomCommandsOptions {
  /** Override the user home for hermetic callers such as tests. */
  homeDir?: string;
  /** Override or disable the packaged command directory. */
  builtinDir?: string | false;
}

const VALID_COMMAND_NAME = /^[a-z0-9][a-z0-9-_]{0,47}$/i;
const MAX_COMMAND_FILE_BYTES = 256 * 1024;

function parseLooseFrontmatter(raw: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^['"]|['"]$/g, "");
    metadata[match[1]] = value;
  }
  return metadata;
}

function parseCommandMetadata(raw: string) {
  try {
    return parse(raw) || {};
  } catch {
    return parseLooseFrontmatter(raw);
  }
}

function parseCommandFile(
  filePath: string,
  source: CustomCommand["source"],
): CustomCommand | null {
  const commandName = basename(filePath, extname(filePath));
  if (!VALID_COMMAND_NAME.test(commandName)) return null;

  const raw = readBoundedRegularFile(filePath, MAX_COMMAND_FILE_BYTES);
  if (raw === undefined) return null;

  let metadata: z.infer<typeof CommandMetadataSchema> = {};
  let template = raw.trim();
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (frontmatter) {
    const parsed = CommandMetadataSchema.safeParse(
      parseCommandMetadata(frontmatter[1]),
    );
    if (!parsed.success) return null;
    metadata = parsed.data;
    template = frontmatter[2].trim();
  }
  if (!template) return null;

  return {
    name: commandName.toLowerCase(),
    description:
      metadata.description || `Run the ${commandName} prompt workflow`,
    argumentHint: metadata.argumentHint || metadata["argument-hint"],
    skills: metadata.skills,
    stages: metadata.stages,
    template,
    source,
    filePath,
  };
}

function loadDirectory(
  directory: string,
  source: CustomCommand["source"],
): CustomCommand[] {
  if (!existsSync(directory)) return [];
  const commands: CustomCommand[] = [];

  const queue = [directory];
  while (queue.length > 0 && commands.length < 200) {
    const current = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          queue.push(join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".md") {
        continue;
      }
      if (commands.length >= 200) break;

      const filePath = join(current, entry.name);
      try {
        const command = parseCommandFile(filePath, source);
        if (command) commands.push(command);
      } catch {
        // A malformed optional command should not prevent Orbit from starting.
      }
    }
  }

  return commands;
}

function mergeDirectory(
  merged: Map<string, CustomCommand>,
  directory: string,
  source: CustomCommand["source"],
  reserved: Set<string>,
): void {
  for (const command of loadDirectory(directory, source)) {
    if (!reserved.has(command.name)) merged.set(command.name, command);
  }
}

export function loadCustomCommands(
  cwd: string,
  reservedNames: Iterable<string> = [],
  options: LoadCustomCommandsOptions = {},
): CustomCommand[] {
  const reserved = new Set(
    Array.from(reservedNames, (name) => name.replace(/^\//, "").toLowerCase()),
  );
  const merged = new Map<string, CustomCommand>();
  const userHome = options.homeDir || homedir();

  const builtinDirectory =
    options.builtinDir === false
      ? undefined
      : options.builtinDir || resolveBundledCommandsDirectory();
  if (builtinDirectory) {
    mergeDirectory(merged, builtinDirectory, "builtin", reserved);
  }

  mergeDirectory(
    merged,
    join(userHome, ".claude", "commands"),
    "user",
    reserved,
  );
  mergeDirectory(
    merged,
    join(userHome, ".orbit", "commands"),
    "user",
    reserved,
  );
  mergeDirectory(merged, join(cwd, ".claude", "commands"), "project", reserved);
  mergeDirectory(merged, join(cwd, ".orbit", "commands"), "project", reserved);

  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function resolveBundledCommandsDirectory(): string {
  const candidates = [
    new URL("../../commands/", import.meta.url),
    new URL("../commands/", import.meta.url),
  ].map((candidate) => fileURLToPath(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/** Resolve declared dependencies, including the previous creator's prefix. */
export function getRequiredCommandSkills(command: CustomCommand): string[] {
  if (command.skills !== undefined) return command.skills;
  // Only migrate the precise generated form; arbitrary prose and user
  // arguments are not dependency declarations.
  const prefix = command.template.match(
    /^(?:Use \$[a-z0-9][a-z0-9-]*\.\s*)+/,
  )?.[0];
  return [
    ...new Set(
      Array.from(
        prefix?.matchAll(/\$([a-z0-9][a-z0-9-]*)/g) ?? [],
        (match) => match[1],
      ),
    ),
  ];
}

function splitCommandArguments(args: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let started = false;
  for (const character of args) {
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
    } else if (!started && (character === '"' || character === "'")) {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) tokens.push(token);
      token = "";
      started = false;
    } else {
      token += character;
      started = true;
    }
  }
  if (quote)
    throw new Error(
      "Unclosed quote in command arguments. Close the quoted argument and retry.",
    );
  if (started) tokens.push(token);
  return tokens;
}

/** Expand template placeholders once; inserted arguments remain literal text. */
export function expandCustomCommand(
  command: CustomCommand,
  rawArguments: string,
): string {
  const args = rawArguments.trim();
  const positional = /\$[0-9]\b/.test(command.template)
    ? splitCommandArguments(args)
    : [];
  const usesClaudeIndexedArgs = /\$0\b/.test(command.template);
  let expanded = command.template.replace(
    /\$ARGUMENTS\b|\{\{\s*args\s*\}\}|\$[0-9]\b/gi,
    (placeholder) => {
      if (!/^\$[0-9]$/.test(placeholder)) return args;
      const index =
        Number(placeholder.slice(1)) - (usesClaudeIndexedArgs ? 0 : 1);
      return positional[index] ?? "";
    },
  );

  if (
    args &&
    !/\$ARGUMENTS\b|\{\{\s*args\s*\}\}|\$[0-9]\b/i.test(command.template)
  ) {
    expanded += `\n\nAdditional user arguments:\n${args}`;
  }
  const declarations = (command.skills ?? [])
    .filter((name) => !new RegExp(`\\$${name}(?![a-z0-9-])`).test(expanded))
    .map((name) => `Use $${name}.`);
  return [...declarations, expanded.trim()].join("\n");
}
