import { relative } from "node:path";
import { readBoundedRegularFile, resolveSafePath } from "@orbit-build/shared";
import type {
  Checkpoint,
  CheckpointManager,
  RollbackManager,
} from "@orbit-build/sandbox";
import type { ToolResult } from "@orbit-build/tools";
import type { UserInteraction } from "./AgentInteraction.js";
import { safeAgentLoopErrorMessage } from "./AgentRunOutcome.js";

export const EDIT_FILE_MAX_BYTES = 16 * 1024 * 1024;
const HUNK_REVIEW_MAX_CHARS = 256 * 1024;

interface EditReviewOptions {
  cwd: string;
  filePath: string;
  absolutePath: string;
  before: string | null;
  checkpoint?: Checkpoint;
  checkpoints: Pick<CheckpointManager, "removeCheckpoint">;
  rollback: Pick<RollbackManager, "rollback">;
  interaction: UserInteraction;
  autoAccept: boolean;
  agent?: { id: string; role: string };
}

interface EditHunk {
  start: number;
  end: number;
  before: string[];
  after: string[];
}

/** Review the actual edit and commit a selection, or restore this edit's checkpoint. */
export async function reviewEditTransaction(
  options: EditReviewOptions,
): Promise<ToolResult> {
  const { filePath, before, checkpoint, interaction } = options;
  let after: string;
  try {
    const content = readBoundedRegularFile(
      options.absolutePath,
      EDIT_FILE_MAX_BYTES,
    );
    if (content === undefined)
      throw new Error("Edited file disappeared before review.");
    after = content;
  } catch (error) {
    return {
      ok: false,
      error: `Cannot review ${filePath}: ${safeAgentLoopErrorMessage(error)}`,
    };
  }

  const unchanged = (): boolean => {
    try {
      // Re-resolve after interactive waits. A replacement symlink must not redirect writes.
      const target = resolveSafePath(options.cwd, filePath);
      return (
        relative(target, options.absolutePath) === "" &&
        readBoundedRegularFile(target, EDIT_FILE_MAX_BYTES) === after
      );
    } catch {
      return false;
    }
  };
  const reject = (reason: string): ToolResult => {
    if (!checkpoint)
      return {
        ok: false,
        error: `${reason} No checkpoint is available; the file was left unchanged.`,
      };
    if (!unchanged())
      return {
        ok: false,
        error: `${reason} File changed during review; automatic rollback was stopped to preserve newer changes.`,
      };
    const restored = options.rollback.rollback(checkpoint);
    if (!restored.success)
      return {
        ok: false,
        error: `${reason} Rollback failed: ${restored.error ?? "unknown error"}`,
      };
    options.checkpoints.removeCheckpoint(checkpoint.id);
    interaction.showText(`● Rejected changes. Reverted ${filePath}.`);
    return {
      ok: false,
      error: `${reason} Edits to ${filePath} rejected and rolled back.`,
    };
  };

  try {
    await interaction.showDiff(filePath, before, after);
  } catch (error) {
    if (!options.autoAccept)
      return reject(`Diff review failed: ${safeAgentLoopErrorMessage(error)}.`);
  }
  if (options.autoAccept) return { ok: true };
  try {
    const choice = interaction.reviewFileChange
      ? (await interaction.reviewFileChange({
          filePath,
          before,
          after,
          agentId: options.agent?.id,
          agentRole: options.agent?.role,
        }))
        ? "yes"
        : "no"
      : await interaction.prompt?.askSelect(`Accept changes to ${filePath}?`, [
          { value: "yes", label: "Accept all changes" },
          { value: "hunks", label: "Review and accept by hunk/block" },
          { value: "no", label: "Reject and rollback all changes" },
        ]);
    if (!unchanged())
      return {
        ok: false,
        error:
          "File changed during review; review the newer file before continuing.",
      };
    if (choice === "yes") return { ok: true };
    if (choice !== "hunks") return reject("Changes were rejected by the user.");
    if ((before?.length ?? 0) + after.length > HUNK_REVIEW_MAX_CHARS)
      return reject(
        "File is too large for bounded hunk review; use whole-file review.",
      );

    const lines = before === null ? [] : before.split("\n");
    const hunks = buildHunks(lines, after.split("\n"));
    if (hunks.length === 0) return { ok: true };
    interaction.showText(`● Reviewing ${hunks.length} hunks in ${filePath}:`);
    for (let index = 0; index < hunks.length; index++) {
      const hunk = hunks[index];
      await interaction.showDiff(
        `${filePath} · Hunk #${index + 1}/${hunks.length}`,
        hunk.before.join("\n"),
        hunk.after.join("\n"),
      );
    }
    const selected = await interaction.prompt?.askMultiSelect(
      `Select the hunks to apply to ${filePath}:`,
      hunks.map((hunk, index) => ({
        value: String(index),
        label: `Apply Hunk #${index + 1}`,
        hint: `-${hunk.before.length} lines, +${hunk.after.length} lines`,
      })),
    );
    if (!selected?.length) return reject("No changes were selected.");
    if (
      selected.some(
        (value) => !hunks.some((_, index) => String(index) === value),
      )
    )
      return reject("Hunk selection was invalid.");
    if (!checkpoint) return reject("Partial review requires a checkpoint.");
    if (!unchanged()) return reject("File changed during hunk review.");
    const selection = new Set(selected);
    const merged: string[] = [];
    let cursor = 0;
    for (let index = 0; index < hunks.length; index++) {
      const hunk = hunks[index];
      merged.push(
        ...lines.slice(cursor, hunk.start),
        ...(selection.has(String(index)) ? hunk.after : hunk.before),
      );
      cursor = hunk.end;
    }
    merged.push(...lines.slice(cursor));
    // Reuse the sandbox's atomic, path-checked replacement and compensation.
    const result = options.rollback.rollback({
      ...checkpoint,
      backups: [{ path: filePath, originalContent: merged.join("\n") }],
    });
    if (!result.success)
      return reject(`Hunk merge failed: ${result.error ?? "unknown error"}.`);
    interaction.showText(`✔ Selected hunks merged and saved to ${filePath}.`);
    return { ok: true };
  } catch (error) {
    return reject(`Edit review failed: ${safeAgentLoopErrorMessage(error)}.`);
  }
}

function buildHunks(before: string[], after: string[]): EditHunk[] {
  const hunks: EditHunk[] = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (
      left < before.length &&
      right < after.length &&
      before[left] === after[right]
    ) {
      left++;
      right++;
      continue;
    }
    let match: { left: number; right: number; distance: number } | undefined;
    for (let deltaLeft = 0; deltaLeft <= 20; deltaLeft++) {
      for (let deltaRight = 0; deltaRight <= 20; deltaRight++) {
        const distance = deltaLeft + deltaRight;
        if (!distance || (match && distance >= match.distance)) continue;
        const nextLeft = left + deltaLeft;
        const nextRight = right + deltaRight;
        if (nextLeft > before.length || nextRight > after.length) continue;
        if (
          (nextLeft === before.length && nextRight === after.length) ||
          (nextLeft < before.length &&
            nextRight < after.length &&
            before[nextLeft] === after[nextRight])
        )
          match = { left: nextLeft, right: nextRight, distance };
      }
    }
    const endLeft = match?.left ?? before.length;
    const endRight = match?.right ?? after.length;
    hunks.push({
      start: left,
      end: endLeft,
      before: before.slice(left, endLeft),
      after: after.slice(right, endRight),
    });
    left = endLeft;
    right = endRight;
  }
  return hunks;
}
