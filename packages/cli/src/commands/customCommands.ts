import { existsSync, readdirSync, type Dirent } from "fs";
import { basename, extname, join } from "path";
import { homedir } from "os";
import { parse } from "yaml";
import { z } from "zod";
import { readBoundedRegularFile } from "@orbit-build/shared";

const CommandMetadataSchema = z.object({
  description: z.string().max(240).optional(),
  argumentHint: z.string().max(120).optional(),
  "argument-hint": z.string().max(120).optional(),
});

export interface CustomCommand {
  name: string;
  description: string;
  argumentHint?: string;
  template: string;
  source: "user" | "project";
  filePath: string;
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
): CustomCommand[] {
  const reserved = new Set(
    Array.from(reservedNames, (name) => name.replace(/^\//, "").toLowerCase()),
  );
  const merged = new Map<string, CustomCommand>();

  mergeDirectory(
    merged,
    join(homedir(), ".claude", "commands"),
    "user",
    reserved,
  );
  mergeDirectory(
    merged,
    join(homedir(), ".orbit", "commands"),
    "user",
    reserved,
  );
  mergeDirectory(merged, join(cwd, ".claude", "commands"), "project", reserved);
  mergeDirectory(merged, join(cwd, ".orbit", "commands"), "project", reserved);

  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function expandCustomCommand(
  command: CustomCommand,
  rawArguments: string,
): string {
  const args = rawArguments.trim();
  const positional = args ? args.split(/\s+/) : [];
  const usesClaudeIndexedArgs = /\$0\b/.test(command.template);
  let expanded = command.template
    .replace(/\$ARGUMENTS\b/g, args)
    .replace(/\{\{\s*args\s*\}\}/gi, args);

  if (usesClaudeIndexedArgs) {
    for (let index = 0; index <= 9; index++) {
      expanded = expanded.replace(
        new RegExp(`\\$${index}\\b`, "g"),
        positional[index] || "",
      );
    }
  } else {
    for (let index = 1; index <= 9; index++) {
      expanded = expanded.replace(
        new RegExp(`\\$${index}\\b`, "g"),
        positional[index - 1] || "",
      );
    }
  }

  if (
    args &&
    !/\$ARGUMENTS\b|\{\{\s*args\s*\}\}|\$[0-9]\b/i.test(command.template)
  ) {
    expanded += `\n\nAdditional user arguments:\n${args}`;
  }
  return expanded.trim();
}
