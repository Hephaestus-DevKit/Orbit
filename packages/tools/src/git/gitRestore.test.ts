import {
  mockModule,
  afterEach,
  describe,
  expect,
  it,
  mockTools as vi,
} from "../../../../scripts/testing/support.mjs";

const execaMock = vi.fn(async () => ({ stdout: "restored" }));

await mockModule(import.meta.resolve("execa"), () => ({ execa: execaMock }));

const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("fs");
const { tmpdir } = await import("os");
const { join } = await import("path");
const { GitRestoreTool } = await import("./gitRestore.js");

describe("GitRestoreTool", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    execaMock.mockClear();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses literal pathspecs after validating workspace paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-git-restore-"));
    tempRoots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "--source=HEAD.ts"), "changed", "utf8");

    const result = await new GitRestoreTool().execute(
      { paths: ["src/--source=HEAD.ts"] },
      { cwd: root, sessionId: "test" },
    );

    expect(result.ok).toBe(true);
    expect(execaMock).toHaveBeenCalledWith(
      "git",
      ["--literal-pathspecs", "restore", "--", "src/--source=HEAD.ts"],
      expect.objectContaining({ cwd: root }),
    );
  });

  it("rejects paths outside the workspace before invoking git", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-git-restore-"));
    tempRoots.push(root);

    const result = await new GitRestoreTool().execute(
      { paths: ["../outside.txt"] },
      { cwd: root, sessionId: "test" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside workspace boundary");
    expect(execaMock).not.toHaveBeenCalled();
  });
});
