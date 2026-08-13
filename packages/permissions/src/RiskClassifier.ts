import { ToolRisk, normalizePath } from "@orbit-build/shared";

const DANGEROUS_COMMAND_REGEXES = [
  /\brm\b[^\r\n;&|]*\s-[a-z]*r[a-z]*(?=\s|$)/i,
  /\brm\b[^\r\n;&|]*--recursive\b/i,
  /\bdel\s+\/s\b/i,
  /\b(?:rmdir|rd)\s+\/s\b/i,
  /\bremove-item\b.*(?:-recurse|-force)\b/i,
  /\b(?:ri|rmdir|rd|del|erase)\b[^\r\n;&|]*(?:-recurse\b|\s-r[a-z]*(?=\s|$))/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\bsudo\b/i,
  /\bformat(?:\.com)?\b/i,
  /\bdiskpart\b/i,
  /\bshutdown\b/i,
  /\bstop-computer\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+(?:checkout|restore)\s+.*(?:--|\.)\b/i,
  /\bgit\s+push\s+.*--force(?:-with-lease)?\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\brsync\b/i,
];

const NETWORK_COMMAND_REGEXES = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\binvoke-webrequest\b/i,
  /\binvoke-restmethod\b/i,
  /\b(?:iwr|irm)\b/i,
  /\bnpx\b/i,
  /\bpnpm\s+dlx\b/i,
  /\bbunx\b/i,
  /\bnpm\s+install\b/i,
  /\bnpm\s+publish\b/i,
  /\bpnpm\s+install\b/i,
  /\bpnpm\s+add\b/i,
  /\bpnpm\s+publish\b/i,
  /\byarn\s+install\b/i,
  /\byarn\s+add\b/i,
  /\byarn\s+publish\b/i,
  /\b(?:pip|pip3|uv\s+pip)\s+install\b/i,
  /\buv\s+(?:tool\s+install|runx|x)\b/i,
  /\bcargo\s+install\b/i,
  /\bgo\s+install\b/i,
  /\bgo\s+get\b/i,
  /\bgit\s+(?:fetch|pull|push|clone|ls-remote|submodule\s+(?:add|update))\b/i,
  /\bgh\s+(?:api|auth|pr|issue|release|repo|workflow|run)\b/i,
  /\bdocker\s+(?:pull|push|login|buildx)\b/i,
  /\bpodman\s+(?:pull|push|login)\b/i,
  /\b(?:ssh|scp|sftp|rsync)\b/i,
];

export class RiskClassifier {
  public static isProtectedPath(
    filePath: string,
    protectedPaths: string[],
  ): boolean {
    const normalized = normalizePath(filePath).toLowerCase();

    for (const pattern of protectedPaths) {
      const cleanPattern = pattern.replace(/\\/g, "/").toLowerCase();

      // Simple glob replacement matching
      const escaped = cleanPattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "__DOUBLE_STAR__")
        .replace(/\*/g, "[^/]*")
        .replace(/__DOUBLE_STAR__\/?/g, "(?:|.*/)");

      const regex = new RegExp(`^${escaped}$`);
      const regexEndsWith = new RegExp(`${escaped}$`);

      if (
        regex.test(normalized) ||
        regexEndsWith.test(normalized) ||
        normalized.includes(cleanPattern.replace(/\*/g, ""))
      ) {
        return true;
      }
    }

    return false;
  }

  public static classifyBashCommand(command: string): ToolRisk {
    for (const regex of DANGEROUS_COMMAND_REGEXES) {
      if (regex.test(command)) {
        return "dangerous";
      }
    }

    for (const regex of NETWORK_COMMAND_REGEXES) {
      if (regex.test(command)) {
        return "network";
      }
    }

    return "execute";
  }
}
