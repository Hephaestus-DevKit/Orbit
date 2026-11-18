import { localizeOrbit, type OrbitConfig } from "@orbit-build/config";
import {
  BUILTIN_SLASH_COMMANDS,
  SLASH_COMMAND_DEFINITIONS,
  localizeSlashText,
  type SlashCommandDetail,
} from "../runtime/SlashCommandCatalog.js";
import { getProviderModelCandidates } from "../runtime/ModelCatalog.js";
import { rankSlashCandidates } from "./TuiInputHelpers.js";
export interface SlashCompletionContext {
  input: string;
  hidden: boolean;
  config?: OrbitConfig;
  candidates: {
    commands: string[];
    commandDetails: SlashCommandDetail[];
    files: string[];
    sessions: string[];
  } | null;
}

/** Resolve slash completions from a snapshot of the current input and catalog. */
export function getActiveSlashMatches(
  context: SlashCompletionContext,
): string[] {
  if (!context.input.startsWith("/")) return [];
  if (context.hidden) return [];

  const line = context.input;
  const parts = line.split(/\s+/);

  if (parts[0] === "/add" && line.includes(" ")) {
    const query = line.slice(5).trim();
    let prefix = "/add ";
    if (query.startsWith("-r ")) {
      prefix = "/add -r ";
    } else if (query.startsWith("--read-only ")) {
      prefix = "/add --read-only ";
    } else if (query.startsWith("--readonly ")) {
      prefix = "/add --readonly ";
    } else if (
      query === "-r"
      || query === "--read-only"
      || query === "--readonly"
    ) {
      prefix = `/add ${parts[1]} `;
    }
    const hits = rankSlashCandidates(
      (context.candidates?.files || []).map((f) => `${prefix}${f}`),
      line,
    );
    if (hits.length > 0) return hits;
  }

  if (parts[0] === "/drop" && line.includes(" ")) {
    const hits = rankSlashCandidates(
      (context.candidates?.files || []).map((f) => `/drop ${f}`),
      line,
    );
    if (hits.length > 0) return hits;
  }

  if (parts[0] === "/model" && line.includes(" ")) {
    const models = getProviderModelCandidates(context.config);

    const hits = rankSlashCandidates(
      models.map((m) => `/model ${m}`),
      line,
    );
    if (hits.length > 0) return hits;
  }

  if (parts[0] === "/chat" && line.includes(" ")) {
    // 1. If it's just "/chat " completing the subcommand
    if (parts.length <= 2) {
      const subcommands = ["list", "ls", "new", "delete", "rm", "switch"];
      const hits = rankSlashCandidates(
        subcommands.map((sub) => `/chat ${sub}`),
        line,
      );
      if (hits.length > 0) return hits;
    }

    // 2. If it's "/chat delete <query>", "/chat switch <query>", "/chat rm <query>"
    if (parts.length >= 3 && ["delete", "rm", "switch"].includes(parts[1])) {
      const cmd = parts[0];
      const sub = parts[1];
      const prefix = `${cmd} ${sub} `;
      const hits = rankSlashCandidates(
        (context.candidates?.sessions || []).map((s) => `${prefix}${s}`),
        line,
      );
      if (hits.length > 0) return hits;
    }
  }

  if (line.includes(" ")) {
    const definition = SLASH_COMMAND_DEFINITIONS.find(
      ({ command }) => command === parts[0],
    );
    if (definition?.suggestions?.length) {
      const hits = rankSlashCandidates(
        definition.suggestions.map(
          ({ value }) => `${definition.command} ${value}`,
        ),
        line,
      );
      if (hits.length > 0) return hits;
    }
  }

  const cmds = context.candidates
      && Array.isArray(context.candidates.commands)
      && context.candidates.commands.length > 0
    ? context.candidates.commands
    : BUILTIN_SLASH_COMMANDS;
  return rankSlashCandidates(cmds, line);
}

/** Localize the description of one completion without accessing terminal state. */
export function getSlashMatchHint(
  context: SlashCompletionContext,
  match: string,
): string {
  const language = context.config?.language ?? "en";
  const command = match.split(/\s+/, 1)[0];
  const definition = SLASH_COMMAND_DEFINITIONS.find(
    (candidate) => candidate.command === command,
  );
  if (definition) {
    const invocation = match.slice(command.length).trim();
    const suggestion = definition.suggestions?.find(
      ({ value }) => value.trim() === invocation,
    );
    if (suggestion) {
      return localizeSlashText(suggestion.description, language);
    }
  }
  const detail = context.candidates?.commandDetails.find(
    (candidate) => candidate.command === command,
  );
  if (detail) return detail.description;
  if (match.startsWith("/chat delete ") || match.startsWith("/chat rm ")) {
    return localizeOrbit(
      language,
      "Delete this chat",
      "删除该聊天",
      "刪除該聊天",
    );
  }
  if (match.startsWith("/chat switch ")) {
    return localizeOrbit(
      language,
      "Switch to this chat",
      "切换到该聊天",
      "切換到該聊天",
    );
  }
  if (definition) {
    return localizeSlashText(definition.description, language);
  }
  return "";
}
