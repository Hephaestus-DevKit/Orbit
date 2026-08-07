import os from "os";
import path from "path";

/**
 * Conservative extraction of filesystem paths referenced by a shell command,
 * so bash is subject to the same protected-path and workspace-boundary
 * policy as the file tools instead of bypassing both.
 *
 * This is not a shell parser. It tokenizes with quote awareness, separates
 * shell control/redirection operators, and keeps tokens that plausibly name
 * files. Ambiguous path expansions are surfaced to the permission engine
 * instead of being silently treated as safe.
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
    } else if (/\s/.test(char) || /[;|&<>]/.test(char)) {
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

/** Return the first shell word so a verified executable can be distinguished from its arguments. */
export function extractCommandExecutable(command: string): string | undefined {
  return tokenize(command)[0];
}

export function extractCommandPaths(command: string): CommandPathCandidates {
  const pathTokens: string[] = [];
  const bareTokens: string[] = [];

  for (const rawToken of tokenize(command)) {
    const token = rawToken;
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
      if (/^\/dev\/(?:null|stdin|stdout|stderr|tty)$/i.test(candidate)) {
        continue;
      }
      const hasBackslashPath =
        /^\\\\/.test(candidate) || /(?:^|[\w.)-])\\[\w.(~-]/.test(candidate);
      const looksLikePath =
        candidate.includes("/") ||
        hasBackslashPath ||
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
  let expanded = token
    .replace(/^~(?=$|[\\/])/, home)
    .replace(/^\$HOME(?=$|[\\/])/, home)
    .replace(/^%USERPROFILE%/i, home);
  if (/[%$]/.test(expanded)) return null;
  if (process.platform === "win32") {
    const msysPath = /^\/([A-Za-z])(?:\/(.*))?$/.exec(expanded);
    if (msysPath) {
      expanded = `${msysPath[1].toUpperCase()}:\\${(msysPath[2] || "").replace(/\//g, "\\")}`;
    }
  }
  try {
    return path.resolve(workspaceRoot, expanded);
  } catch {
    return null;
  }
}
