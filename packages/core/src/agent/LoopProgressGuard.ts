/**
 * Detects a stalled agent loop: the model repeating the same tool call (or the
 * same failing tool call) without making progress. Weak models are the primary
 * beneficiaries — they tend to re-issue an identical read or a failing edit
 * until the iteration budget burns out.
 *
 * Legitimate repetition is interleaved with other work (edit → test → edit →
 * test), so only *consecutive* identical calls count as a stall signal.
 */

export interface ToolCallObservation {
  name: string;
  arguments: string;
  ok: boolean;
}

export type LoopGuardReason = "repeated_identical_call" | "repeated_failure" | "repeated_probe";

export interface LoopGuardNudge {
  reason: LoopGuardReason;
  /** How many consecutive identical calls triggered this nudge. */
  repeatCount: number;
  /** Guidance appended to the tool result so the model always sees it. */
  message: string;
}

const IDENTICAL_CALL_THRESHOLD = 3;
const REPEATED_FAILURE_THRESHOLD = 2;
/** After a nudge, stay silent until the streak grows by this much again. */
const RENUDGE_INCREMENT = 2;

function canonicalizeArguments(toolName: string, rawArguments: string): string {
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (toolName === "bash") {
      const probe = canonicalizeShellProbe(parsed);
      if (probe) return probe;
    }
    return JSON.stringify(sortValue(parsed));
  } catch {
    return rawArguments.trim();
  }
}

function canonicalizeShellProbe(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const command = (value as Record<string, unknown>).command;
  if (typeof command !== "string") return undefined;
  const looksLikeProbe =
    /(?:\b(?:Get-Content|Select-String|grep|sed|head|tail|cat)\b|\bpython(?:\.exe)?\b[\s\S]*\b(?:open|read_text|read_bytes)\s*\()/i
      .test(
        command,
      );
  const looksMutatingOrExecutable =
    /(?:\b(?:Set-Content|Add-Content|Remove-Item|Move-Item|Copy-Item|xelatex|pdflatex|npm|pnpm|yarn|pytest|vitest)\b|(?:^|\s)(?:>|>>)(?:\s|$)|\.write\s*\()/i
      .test(
        command,
      );
  if (!looksLikeProbe || looksMutatingOrExecutable) return undefined;
  const files = command.match(
    /[\p{L}\p{N}_./\\:@+~-]+\.(?:[cm]?[jt]sx?|py|json|ya?ml|toml|md|tex|log|txt|csv|xml|html|css|scss|sql|rs|go|java|kt|swift)/giu,
  );
  if (!files?.length) return undefined;
  const normalized = [
    ...new Set(files.map((file) => file.replace(/\\/g, "/"))),
  ].sort();
  return `shell-probe:${normalized.join("|")}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export class LoopProgressGuard {
  private lastSignature = "";
  private streakLength = 0;
  private failureStreakLength = 0;
  private nextNudgeAt = 0;

  reset(): void {
    this.lastSignature = "";
    this.streakLength = 0;
    this.failureStreakLength = 0;
    this.nextNudgeAt = 0;
  }

  /**
   * Record one executed tool call. Returns a nudge when the call extends a
   * no-progress streak past a threshold, or null when the loop looks healthy.
   */
  record(observation: ToolCallObservation): LoopGuardNudge | null {
    const canonicalArguments = canonicalizeArguments(
      observation.name,
      observation.arguments,
    );
    const signature = JSON.stringify([observation.name, canonicalArguments]);
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.streakLength = 1;
      this.failureStreakLength = observation.ok ? 0 : 1;
      this.nextNudgeAt = 0;
      return null;
    }

    this.streakLength += 1;
    this.failureStreakLength = observation.ok
      ? 0
      : this.failureStreakLength + 1;

    if (this.streakLength < this.nextNudgeAt) return null;

    if (this.failureStreakLength >= REPEATED_FAILURE_THRESHOLD) {
      this.nextNudgeAt = this.streakLength + RENUDGE_INCREMENT;
      return {
        reason: "repeated_failure",
        repeatCount: this.failureStreakLength,
        message:
          `[Loop guard] The "${observation.name}" call failed ${this.failureStreakLength} times in a row with identical arguments. `
          + "Repeating it again will fail the same way. Change the arguments, fix the underlying problem first, or explain the blocker to the user instead of retrying.",
      };
    }

    if (this.streakLength >= IDENTICAL_CALL_THRESHOLD) {
      this.nextNudgeAt = this.streakLength + RENUDGE_INCREMENT;
      const repeatedProbe = canonicalArguments.startsWith("shell-probe:");
      return {
        reason: repeatedProbe ? "repeated_probe" : "repeated_identical_call",
        repeatCount: this.streakLength,
        message: repeatedProbe
          ? `[Loop guard] You have made ${this.streakLength} consecutive read-only shell probes against the same file(s). Stop varying grep/sed/Python snippets. Use the evidence already collected, use read_file once with a focused range, or repair the reported line directly.`
          : `[Loop guard] You have now made the exact same "${observation.name}" call ${this.streakLength} times in a row. The result will not change. Use the information you already have, take a different action, or report what is blocking you.`,
      };
    }

    return null;
  }
}
