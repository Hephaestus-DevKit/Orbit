import os from "os";
import path from "path";

/**
 * Conservative extraction of filesystem paths referenced by a shell command,
 * so bash is subject to the same protected-path and workspace-boundary
 * policy as the file tools instead of bypassing both.
 *
 * This is not a shell parser. It tokenizes with quote awareness and keeps
 * only tokens that plausibly name files, preferring false negatives over
 * false positives — the regex risk classifier still applies independently.
 */

export interface CommandPathCandidates {
  /** Tokens that look like real paths: slashes, drive letters, `~`, dotfiles. */
  pathTokens: string[];
  /** Bare filename-like tokens, checked against protected patterns only. */
  bareTokens: string[];
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export function extractCommandPaths(command: string): CommandPathCandidates {
  const pathTokens: string[] = [];
  const bareTokens: string[] = [];

  for (const rawToken of tokenize(command)) {
    // Strip attached redirection operators: `>file`, `2>>file`, `&>file`.
    const token = rawToken.replace(/^(?:\d*>>?|&>>?|<)/, "");
    if (!token) continue;

    const candidates: string[] = [];
    if (token.startsWith("-")) {
      // Flags themselves are not paths, but `--output=path` embeds one.
      const equalsIndex = token.indexOf("=");
      if (equalsIndex !== -1) candidates.push(token.slice(equalsIndex + 1));
    } else {
      candidates.push(token);
    }

    for (const candidate of candidates) {
      if (!candidate || candidate.includes("://")) continue;
      const looksLikePath =
        /[\\/]/.test(candidate) ||
        /^[A-Za-z]:/.test(candidate) ||
        candidate.startsWith("~") ||
        /^\.[\w.-]+$/.test(candidate);
      if (looksLikePath) {
        pathTokens.push(candidate);
      } else if (/^[\w][\w.-]*$/.test(candidate)) {
        bareTokens.push(candidate);
      }
    }
  }

  return { pathTokens, bareTokens };
}

/**
 * Expand home-directory prefixes and resolve against the workspace root.
 * Returns null for tokens containing unresolvable expansions — those are
 * skipped rather than guessed at.
 */
export function resolveCommandPathCandidate(
  token: string,
  workspaceRoot: string,
): string | null {
  const home = os.homedir();
  const expanded = token
    .replace(/^~(?=$|[\\/])/, home)
    .replace(/^\$HOME(?=$|[\\/])/, home)
    .replace(/^%USERPROFILE%/i, home);
  if (/[%$]/.test(expanded)) return null;
  try {
    return path.resolve(workspaceRoot, expanded);
  } catch {
    return null;
  }
}
