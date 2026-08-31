import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitDiffTool } from "./gitDiff.js";
import { GitStatusTool } from "./gitStatus.js";

const runGit = vi.hoisted(() =>
  vi.fn(async (_file: string, _args: string[], _options: unknown) => ({
    stdout: "",
  })),
);

vi.mock("execa", () => ({ execa: runGit }));

describe("parallel read-only Git tools", () => {
  beforeEach(() => {
    runGit.mockReset();
    runGit.mockResolvedValue({ stdout: "" });
  });

  it.each([new GitStatusTool(), new GitDiffTool()])(
    "$name disables optional index writes and executable fsmonitor hooks",
    async (tool) => {
      const controller = new AbortController();
      const result = await tool.execute(
        {},
        {
          cwd: process.cwd(),
          sessionId: "git-read-test",
          abortSignal: controller.signal,
        },
      );

      expect(result.ok).toBe(true);
      expect(runGit).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining([
          "--no-optional-locks",
          "-c",
          "core.fsmonitor=false",
        ]),
        expect.objectContaining({
          cwd: process.cwd(),
          signal: controller.signal,
          extendEnv: false,
          windowsHide: true,
        }),
      );
    },
  );

  it.each([false, true])(
    "git_diff disables executable diff drivers for staged=%s",
    async (staged) => {
      await new GitDiffTool().execute(
        { staged },
        {
          cwd: process.cwd(),
          sessionId: "git-read-test",
        },
      );

      const args = runGit.mock.calls[0]?.[1];
      expect(args).toEqual([
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        ...(staged ? ["--staged"] : []),
      ]);
    },
  );

  it.each([new GitStatusTool(), new GitDiffTool()])(
    "$name retains output redaction",
    async (tool) => {
      const secret = `sk-${"fixture".repeat(8)}`;
      runGit.mockResolvedValue({ stdout: `modified: ${secret}` });

      const result = await tool.execute(
        {},
        {
          cwd: process.cwd(),
          sessionId: "git-read-test",
        },
      );

      expect(result.data).toContain("***REDACTED***");
      expect(result.data).not.toContain(secret);
      expect(result.display).not.toContain(secret);
    },
  );
});
