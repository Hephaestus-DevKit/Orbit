import {
  checkWorkspaceBoundary,
  resolveSafePath,
  ToolRisk,
} from "@orbit-build/shared";
import { isFullAccessEnabled, OrbitConfig } from "@orbit-build/config";
import { PermissionDecision } from "./types.js";
import fs from "fs";
import os from "os";
import path from "path";
import { RiskClassifier } from "./RiskClassifier.js";
import {
  analyzeCommandIndirection,
  extractCommandPaths,
  extractCommandExecutable,
  resolveCommandPathCandidate,
} from "./CommandPathAnalyzer.js";

export class PermissionEngine {
  private trustedRoots: string[] = [];

  constructor(
    private config: OrbitConfig,
    private workspaceRoot?: string,
  ) {}

  /** Active, validated Skill roots authorized for this turn. */
  public setTrustedRoots(roots: string[]): void {
    this.trustedRoots = roots;
  }

  private commandTrustedRoots(
    mode: OrbitConfig["permissions"]["mode"],
  ): string[] {
    if (mode !== "auto") return this.trustedRoots;
    const fontRoots =
      process.platform === "win32"
        ? [path.join(process.env.WINDIR || "C:\\Windows", "Fonts")]
        : process.platform === "darwin"
          ? [
              "/Library/Fonts",
              "/System/Library/Fonts",
              path.join(os.homedir(), "Library", "Fonts"),
            ]
          : [
              "/usr/share/fonts",
              "/usr/local/share/fonts",
              path.join(os.homedir(), ".local", "share", "fonts"),
            ];
    return Array.from(
      new Set([...this.trustedRoots, os.tmpdir(), ...fontRoots]),
    );
  }

  private isTrustedExecutable(resolved: string): boolean {
    const executableDirectory = path.resolve(path.dirname(resolved));
    const pathRoots = (process.env.PATH || "")
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => path.resolve(entry));
    if (!pathRoots.some((entry) => entry === executableDirectory)) return false;
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return false;
      return process.platform === "win32"
        ? /\.(?:exe|cmd|bat|com)$/i.test(resolved)
        : (stat.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }

  public evaluate(
    toolName: string,
    args: unknown,
    declaredRisk?: ToolRisk,
  ): PermissionDecision {
    const mode = this.config.permissions.mode;
    const protectedPaths = this.config.permissions.protectedPaths;

    let risk: ToolRisk = declaredRisk || "read";
    let targetPath: string | undefined;
    let cmdString: string | undefined;

    const readTools = new Set([
      "read_file",
      "list_files",
      "glob",
      "grep",
      "inspect_project",
      "detect_project",
      "search_symbols",
      "find_symbol_references",
      "git_status",
      "git_diff",
    ]);
    const writeTools = new Set([
      "write_file",
      "edit_file",
      "replace_file_content",
      "multi_replace_file_content",
    ]);

    const safeArgs = isRecord(args) ? args : {};

    if (toolName === "update_plan") {
      return {
        action: "allow",
        reason: "Updating the current chat plan does not modify project files.",
        risk: "write",
      };
    }

    if (readTools.has(toolName) || writeTools.has(toolName)) {
      targetPath = firstString(
        safeArgs.path,
        safeArgs.TargetFile,
        safeArgs.filePath,
        safeArgs.file,
      );
      risk = readTools.has(toolName) ? "read" : "write";
    } else if (toolName === "bash") {
      cmdString = firstString(safeArgs.command);
      risk = RiskClassifier.classifyBashCommand(cmdString || "");
    } else if (toolName === "run_tests") {
      cmdString = firstString(safeArgs.command);
      risk = cmdString
        ? RiskClassifier.classifyBashCommand(cmdString)
        : "execute";
    } else if (toolName === "git_commit") {
      risk = "execute";
    } else if (toolName === "git_restore") {
      risk = "dangerous";
    }

    if (isFullAccessEnabled(this.config)) {
      return {
        action: "allow",
        reason: "Allowed by Full Access.",
        risk,
      };
    }

    if (
      this.config.permissions.protectSecrets &&
      targetPath &&
      RiskClassifier.isProtectedPath(targetPath, protectedPaths)
    ) {
      if (mode === "strict") {
        return {
          action: "deny",
          reason: `Access to protected path "${targetPath}" is blocked under strict mode.`,
          risk,
        };
      }
      return {
        action: "ask",
        reason: `Tool requested access to protected path "${targetPath}".`,
        risk,
      };
    }

    if (risk === "read" && !this.config.permissions.allowRead) {
      return {
        action: "deny",
        reason: "Read operations are disabled by configuration.",
        risk,
      };
    }

    if (risk === "dangerous") {
      if (this.config.permissions.blockDangerousCommands) {
        return {
          action: "deny",
          reason: `Dangerous operation "${toolName}" is blocked by configuration.`,
          risk,
        };
      }
      risk = "execute";
    }

    // Shell commands must honor the same protected-path and workspace
    // boundary policy as the file tools instead of bypassing both.
    if ((toolName === "bash" || toolName === "run_tests") && cmdString) {
      const indirection = analyzeCommandIndirection(cmdString);
      if (indirection.opaque) {
        if (mode === "strict") {
          return {
            action: "deny",
            reason: `Command cannot be statically bounded because ${indirection.reason}; blocked under strict mode.`,
            risk,
          };
        }
        if (mode === "auto") {
          return {
            action: "ask",
            reason: `Auto mode is not configured as complete Full Access, so confirmation is required because ${indirection.reason}. Inline interpreters can bypass workspace and secret path inspection.`,
            risk,
          };
        }
      }
      const commandPaths = extractCommandPaths(cmdString);

      if (this.config.permissions.protectSecrets) {
        const protectedHit = [
          ...commandPaths.pathTokens,
          ...commandPaths.bareTokens,
        ].find((candidate) =>
          RiskClassifier.isProtectedPath(candidate, protectedPaths),
        );
        if (protectedHit) {
          if (mode === "strict") {
            return {
              action: "deny",
              reason: `Command references protected path "${protectedHit}", blocked under strict mode.`,
              risk,
            };
          }
          return {
            action: "ask",
            reason: `Command references protected path "${protectedHit}".`,
            risk,
          };
        }
      }

      if (this.workspaceRoot) {
        const workspaceRoot = this.workspaceRoot;
        const trustedRoots = this.commandTrustedRoots(mode);
        const executableToken = extractCommandExecutable(cmdString);
        const unresolvedPath = commandPaths.pathTokens.find(
          (token) => resolveCommandPathCandidate(token, workspaceRoot) === null,
        );
        if (unresolvedPath) {
          if (mode === "strict") {
            return {
              action: "deny",
              reason: `Command path "${unresolvedPath}" contains an unresolved expansion, blocked under strict mode.`,
              risk,
            };
          }
          return {
            action: "ask",
            reason: `Command path "${unresolvedPath}" contains an unresolved expansion.`,
            risk,
          };
        }
        const linkedWorkspaceEscape = commandPaths.pathTokens.find((token) => {
          const resolved = resolveCommandPathCandidate(token, workspaceRoot);
          if (
            resolved === null ||
            !checkWorkspaceBoundary(workspaceRoot, resolved) ||
            !fs.existsSync(workspaceRoot)
          ) {
            return false;
          }
          try {
            resolveSafePath(workspaceRoot, resolved);
            return false;
          } catch {
            return true;
          }
        });
        if (linkedWorkspaceEscape) {
          if (mode === "strict") {
            return {
              action: "deny",
              reason: `Command path "${linkedWorkspaceEscape}" does not resolve safely inside the workspace, blocked under strict mode.`,
              risk,
            };
          }
          return {
            action: "ask",
            reason: `Command path "${linkedWorkspaceEscape}" does not resolve safely inside the workspace. It may traverse a symbolic link or junction.`,
            risk,
          };
        }
        const outsidePath = commandPaths.pathTokens.find((token) => {
          const resolved = resolveCommandPathCandidate(token, workspaceRoot);
          return (
            resolved !== null &&
            !checkWorkspaceBoundary(workspaceRoot, resolved) &&
            !trustedRoots.some((root) =>
              checkWorkspaceBoundary(root, resolved),
            ) &&
            !(
              mode === "auto" &&
              token === executableToken &&
              this.isTrustedExecutable(resolved)
            )
          );
        });
        if (outsidePath) {
          if (mode === "strict") {
            return {
              action: "deny",
              reason: `Command references "${outsidePath}" outside the workspace, blocked under strict mode.`,
              risk,
            };
          }
          return {
            action: "ask",
            reason: `Command references "${outsidePath}" outside the workspace.`,
            risk,
          };
        }
      }
    }

    if (mode === "plan") {
      if (risk === "read") {
        return {
          action: "allow",
          reason: "Read is allowed under plan mode.",
          risk,
        };
      }
      return {
        action: "deny",
        reason: `Action requires "${risk}" permission, which is blocked under plan mode.`,
        risk,
      };
    }

    if (risk === "write" && this.config.permissions.requireApprovalForWrite) {
      return {
        action: "ask",
        reason: "Write approval is required by configuration.",
        risk,
      };
    }

    if (
      (toolName === "bash" ||
        toolName === "run_tests" ||
        toolName === "git_commit") &&
      this.config.permissions.requireApprovalForBash
    ) {
      return {
        action: "ask",
        reason: "Command execution approval is required by configuration.",
        risk,
      };
    }

    if (mode === "strict") {
      if (risk === "read") {
        return {
          action: "allow",
          reason: "Read operations are allowed.",
          risk,
        };
      }
      if (risk === "network") {
        return {
          action: "deny",
          reason: `Dangerous or network operations ("${toolName}") are blocked under strict mode.`,
          risk,
        };
      }
      return {
        action: "ask",
        reason: `Strict mode requires confirmation for all write and execution operations.`,
        risk,
      };
    }

    if (mode === "normal") {
      if (risk === "read") {
        return {
          action: "allow",
          reason: "Read operations are allowed.",
          risk,
        };
      }
      return {
        action: "ask",
        reason: `Normal mode requires user confirmation for "${toolName}" (${risk}).`,
        risk,
      };
    }

    if (mode === "auto") {
      if (
        risk === "read" ||
        risk === "write" ||
        risk === "execute" ||
        risk === "network"
      ) {
        return {
          action: "allow",
          reason: `Automatically allowed under auto mode.`,
          risk,
        };
      }
      return {
        action: "ask",
        reason: `Auto mode requires user confirmation for "${toolName}" (${risk}).`,
        risk,
      };
    }

    return {
      action: "ask",
      reason: "Unclassified tool risk, prompting user.",
      risk,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}
