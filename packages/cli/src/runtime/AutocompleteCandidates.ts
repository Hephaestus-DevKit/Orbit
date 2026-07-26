import glob from "fast-glob";
import { existsSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { z } from "zod";
import type { OrbitLanguage } from "@orbit-build/config";
import { loadCustomCommands } from "../commands/customCommands.js";
import {
  BUILTIN_SLASH_COMMANDS,
  buildBuiltinSlashCommandDetails,
  type SlashCommandDetail,
} from "./SlashCommandCatalog.js";
import { resolveSafePath } from "@orbit-build/shared";

const symbolIndexSchema = z.object({
  files: z
    .record(
      z.object({
        symbols: z
          .array(
            z.object({
              name: z.string().min(1),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export interface AutocompleteConfig {
  language?: OrbitLanguage;
  context?: {
    ignore?: string[];
  };
  session?: {
    path?: string;
  };
}

export interface AutocompleteCandidates {
  commands: string[];
  commandDetails: SlashCommandDetail[];
  files: string[];
  symbols: string[];
  sessions: string[];
}

/** Collects slash commands and workspace-backed completion candidates. */
export async function getAutocompleteCandidates(
  cwd: string,
  config: AutocompleteConfig,
): Promise<AutocompleteCandidates> {
  const customCommands = loadCustomCommands(cwd, BUILTIN_SLASH_COMMANDS);
  const commands = [
    ...BUILTIN_SLASH_COMMANDS,
    ...customCommands.map((command) => `/${command.name}`),
  ];
  const commandDetails: SlashCommandDetail[] = [
    ...buildBuiltinSlashCommandDetails(config.language ?? "en"),
    ...customCommands.map((command) => ({
      command: `/${command.name}`,
      description: command.description,
      argumentHint: command.argumentHint,
      category: "workflow" as const,
      source: command.source,
    })),
  ];
  const files: string[] = [];
  const symbols: string[] = [];
  const sessions: string[] = [];

  const normCwd = resolve(cwd).toLowerCase().replace(/\\/g, "/");
  const normHome = resolve(homedir()).toLowerCase().replace(/\\/g, "/");
  const isHomeOrRoot =
    normCwd === normHome ||
    normCwd === "/" ||
    /^[a-zA-Z]:\/$/.test(normCwd) ||
    dirname(normCwd) === normCwd;

  if (isHomeOrRoot) {
    return { commands, commandDetails, files, symbols, sessions };
  }

  try {
    files.push(
      ...(await glob("**/*", {
        cwd,
        ignore: config.context?.ignore ?? [],
        onlyFiles: true,
        dot: true,
        suppressErrors: true,
      })),
    );
  } catch {
    // Autocomplete remains usable with command-only results.
  }

  try {
    const indexPath = join(cwd, ".orbit", "symbols.json");
    if (existsSync(indexPath)) {
      const result = symbolIndexSchema.safeParse(
        JSON.parse(readFileSync(indexPath, "utf8")),
      );
      if (result.success) {
        for (const fileData of Object.values(result.data.files ?? {})) {
          for (const symbol of fileData.symbols ?? []) {
            symbols.push(symbol.name);
          }
        }
      }
    }
  } catch {
    // Ignore incomplete or concurrently-written index files.
  }

  try {
    const sessionDir = resolveSafePath(
      cwd,
      config.session?.path ?? ".orbit/sessions",
    );
    if (existsSync(sessionDir)) {
      for (const dir of readdirSync(sessionDir)) {
        if (existsSync(join(sessionDir, dir, "session.json"))) {
          sessions.push(dir);
        }
      }
    }
  } catch {
    // Ignore unavailable session metadata.
  }

  return {
    commands,
    commandDetails,
    files,
    symbols: [...new Set(symbols)],
    sessions,
  };
}
