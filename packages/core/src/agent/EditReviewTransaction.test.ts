import { afterEach, describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CheckpointManager, RollbackManager } from "@orbit-build/sandbox";
import { reviewEditTransaction } from "./EditReviewTransaction.js";
import type { UserInteraction } from "./AgentInteraction.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function fixture(
  before: string | null = "a\nb\nc\nd",
  after = "a\nB\nc\nD",
) {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-edit-review-"));
  roots.push(cwd);
  const absolutePath = join(cwd, "file.txt");
  if (before !== null) writeFileSync(absolutePath, before);
  const checkpoints = new CheckpointManager(cwd, "test").initialize();
  const checkpoint = await checkpoints.captureBeforeState("edit", "file.txt");
  writeFileSync(absolutePath, after);
  const interaction: UserInteraction = {
    askApproval: async () => true,
    showDiff: vi.fn(),
    showText: vi.fn(),
    prompt: {
      askText: async () => null,
      askSelect: vi.fn(async () => "hunks"),
      askMultiSelect: vi.fn(async () => ["0"]),
    },
  };
  return {
    cwd,
    filePath: "file.txt",
    absolutePath,
    before,
    checkpoint,
    checkpoints,
    rollback: new RollbackManager(cwd),
    interaction,
    autoAccept: false,
  };
}

describe("edit review transaction", () => {
  it("atomically applies only selected changes and retains the original checkpoint", async () => {
    const options = await fixture();
    await expect(reviewEditTransaction(options)).resolves.toMatchObject({
      ok: true,
    });
    expect(readFileSync(options.absolutePath, "utf8")).toBe("a\nB\nc\nd");
    expect(options.checkpoints.getCheckpoints()).toHaveLength(1);
  });
  it("rolls back the pinned edit when hunk review fails, preserving other checkpoints", async () => {
    const options = await fixture();
    writeFileSync(join(options.cwd, "other.txt"), "keep");
    await options.checkpoints.captureBeforeState("other", "other.txt");
    options.interaction.prompt!.askMultiSelect = async () => {
      throw new Error("review disconnected");
    };
    await expect(reviewEditTransaction(options)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("rolled back"),
    });
    expect(readFileSync(options.absolutePath, "utf8")).toBe(options.before);
    expect(
      options.checkpoints.getCheckpoints().map((c) => c.toolCallId),
    ).toEqual(["other"]);
  });
  it.each([null, [], ["invalid"]])(
    "rejects cancelled, empty or invalid selections: %j",
    async (selection) => {
      const options = await fixture(null, "new file");
      options.interaction.prompt!.askMultiSelect = async () => selection;
      expect((await reviewEditTransaction(options)).ok).toBe(false);
      expect(existsSync(options.absolutePath)).toBe(false);
    },
  );
  it("preserves concurrent file changes while review is pending", async () => {
    const options = await fixture();
    options.interaction.prompt!.askMultiSelect = async () => {
      writeFileSync(options.absolutePath, "newer user edit");
      return ["0"];
    };
    await expect(reviewEditTransaction(options)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("preserve newer"),
    });
    expect(readFileSync(options.absolutePath, "utf8")).toBe("newer user edit");
  });
  it.skipIf(process.platform === "win32")(
    "refuses a symlink swapped during review",
    async () => {
      const options = await fixture();
      const outside = join(options.cwd, "other.txt");
      writeFileSync(outside, "untouched");
      options.interaction.prompt!.askMultiSelect = async () => {
        rmSync(options.absolutePath);
        symlinkSync(outside, options.absolutePath);
        return ["0"];
      };
      expect((await reviewEditTransaction(options)).ok).toBe(false);
      expect(readFileSync(outside, "utf8")).toBe("untouched");
    },
  );
  it("fails closed on broken review rendering and preserves the edit if rollback fails", async () => {
    const options = await fixture();
    options.interaction.showDiff = () => {
      throw new Error("closed");
    };
    vi.spyOn(options.rollback, "rollback").mockReturnValue({
      success: false,
      restored: [],
      error: "disk unavailable",
    });
    await expect(reviewEditTransaction(options)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Rollback failed"),
    });
    expect(readFileSync(options.absolutePath, "utf8")).toBe("a\nB\nc\nD");
  });
  it("accepts the explicit automatic policy even when the display is unavailable", async () => {
    const options = await fixture();
    options.autoAccept = true;
    options.interaction.showDiff = () => {
      throw new Error("closed");
    };
    expect((await reviewEditTransaction(options)).ok).toBe(true);
    expect(options.interaction.prompt?.askSelect).not.toHaveBeenCalled();
  });
});
