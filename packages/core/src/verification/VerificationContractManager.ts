import { z } from "zod";
import fs from "fs";
import path from "path";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import { eventBus } from "../events/EventBus.js";
import { CheckpointManager } from "@orbit-build/sandbox";
import {
  LogTruncator,
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);

function safeFailureOutput(error: unknown): string {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const output = [record.stdout, record.stderr]
    .filter((value): value is string => typeof value === "string" && !!value)
    .join("\n")
    .trim();
  const message = error instanceof Error ? error.message : String(error);
  return LogTruncator.truncate(redactSecrets(output || message), 80, 8000);
}

export const VerificationContractSchema = z.object({
  suites: z.record(z.string()).default({}),
  allowedModifiedFiles: z.array(z.string()).optional(),
  requiredFiles: z.array(z.string()).optional(),
  maxRepairAttempts: z.number().int().min(0).max(10).default(3),
});

export type VerificationContract = z.infer<typeof VerificationContractSchema>;

export class VerificationContractManager {
  private contract: VerificationContract | null = null;

  constructor(
    private cwd: string,
    private sessionId: string,
    private checkpointManager: CheckpointManager,
    private trusted = false,
    private commandTimeoutMs = 120000,
  ) {}

  public initialize(): void {
    if (!this.trusted) return;
    this.loadContract();
  }

  private loadContract(): void {
    const contractPath = path.join(this.cwd, ".orbit", "verification.json");
    if (fs.existsSync(contractPath)) {
      try {
        const content = fs.readFileSync(contractPath, "utf8");
        const parsed = JSON.parse(content);
        const validated = VerificationContractSchema.safeParse(parsed);
        if (validated.success) {
          this.contract = validated.data;
        } else {
          eventBus.emitEvent("warning", {
            message: `Verification contract validation failed: ${validated.error.issues.map((issue) => issue.message).join("; ")}`,
          });
        }
      } catch (error: unknown) {
        eventBus.emitEvent("warning", {
          message: `Verification contract could not be loaded: ${safeFailureOutput(error)}`,
        });
      }
    }
  }

  public hasContract(): boolean {
    return this.contract !== null;
  }

  public getMaxRepairAttempts(): number {
    return this.contract?.maxRepairAttempts ?? 0;
  }

  public async runVerification(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.contract) {
      return { success: true };
    }

    eventBus.emitEvent("verification_started", { type: "contract" });

    try {
      // 1. Run configured suites
      const suites = this.contract.suites;
      for (const [name, command] of Object.entries(suites)) {
        if (command) {
          eventBus.emitEvent("info", {
            message: `Running verification suite: ${name} (${command})...`,
          });
          try {
            await execPromise(command, {
              ...HIDDEN_CHILD_PROCESS_OPTIONS,
              cwd: this.cwd,
              timeout: this.commandTimeoutMs,
              maxBuffer: 1024 * 1024,
            });
          } catch (error: unknown) {
            const output = safeFailureOutput(error);
            eventBus.emitEvent("verification_ended", {
              success: false,
              results: { suite: name, error: output },
            });
            return {
              success: false,
              error: `Verification suite "${name}" failed with output:\n${output}`,
            };
          }
        }
      }

      // 2. Check allowed modified files bounds
      if (
        this.contract.allowedModifiedFiles &&
        this.contract.allowedModifiedFiles.length > 0
      ) {
        eventBus.emitEvent("info", {
          message: "Checking modified files bounds...",
        });
        const modifiedFiles: string[] = [];
        try {
          const { stdout } = await execFilePromise(
            "git",
            ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            {
              ...HIDDEN_CHILD_PROCESS_OPTIONS,
              cwd: this.cwd,
              timeout: this.commandTimeoutMs,
              maxBuffer: 1024 * 1024,
            },
          );
          const records = stdout.split("\0").filter(Boolean);
          for (let index = 0; index < records.length; index++) {
            const record = records[index];
            if (record.length < 4) continue;
            const status = record.slice(0, 2);
            const file = record.slice(3).replace(/\\/g, "/");
            if (file && !file.startsWith(".orbit/") && file !== ".orbit") {
              modifiedFiles.push(file);
            }
            if (/[RC]/.test(status)) index++;
          }
        } catch (error: unknown) {
          const message = `Unable to verify modified-file bounds because Git status failed: ${safeFailureOutput(error)}`;
          eventBus.emitEvent("verification_ended", {
            success: false,
            results: { error: message },
          });
          return { success: false, error: message };
        }

        const patterns = this.contract.allowedModifiedFiles;
        for (const file of modifiedFiles) {
          const matched = patterns.some((pattern) => {
            const escaped = pattern
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*\*/g, "__DOUBLE_STAR__")
              .replace(/\*/g, "[^/]*")
              .replace(/__DOUBLE_STAR__\/?/g, "(?:|.*/)");
            const regex = new RegExp("^" + escaped + "$");
            return regex.test(file);
          });

          if (!matched) {
            eventBus.emitEvent("verification_ended", {
              success: false,
              results: { fileBoundsViolation: file },
            });
            return {
              success: false,
              error: `Modified file "${file}" violates the allowed bounds pattern(s): ${patterns.join(", ")}`,
            };
          }
        }
      }

      // 3. Verify required files are produced
      if (
        this.contract.requiredFiles &&
        this.contract.requiredFiles.length > 0
      ) {
        eventBus.emitEvent("info", {
          message: "Verifying required files existence...",
        });
        for (const requiredFile of this.contract.requiredFiles) {
          const filePath = resolveSafePath(this.cwd, requiredFile);
          if (!fs.existsSync(filePath)) {
            eventBus.emitEvent("verification_ended", {
              success: false,
              results: { missingRequiredFile: requiredFile },
            });
            return {
              success: false,
              error: `Required file "${requiredFile}" was not produced/found.`,
            };
          }
        }
      }

      eventBus.emitEvent("verification_ended", { success: true });
      return { success: true };
    } catch (error: unknown) {
      const message = safeFailureOutput(error);
      eventBus.emitEvent("verification_ended", {
        success: false,
        results: { error: message },
      });
      return { success: false, error: message };
    }
  }
}
