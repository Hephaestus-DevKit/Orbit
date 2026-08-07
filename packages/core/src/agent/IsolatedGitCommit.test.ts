import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareIsolatedGitCommit } from "./IsolatedGitCommit.js";

describe("prepareIsolatedGitCommit", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-isolated-commit-"));
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "orbit@example.invalid"], {
      cwd,
    });
    execFileSync("git", ["config", "user.name", "Orbit Test"], { cwd });
    writeFileSync(join(cwd, "agent.txt"), "base\n", "utf8");
    writeFileSync(join(cwd, "user.txt"), "base\n", "utf8");
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" });
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("commits only Orbit paths and preserves unrelated staged changes", () => {
    writeFileSync(join(cwd, "agent.txt"), "agent change\n", "utf8");
    writeFileSync(join(cwd, "user.txt"), "user staged\n", "utf8");
    execFileSync("git", ["add", "user.txt"], { cwd });

    const prepared = prepareIsolatedGitCommit(cwd, ["agent.txt"]);
    expect(prepared.diff).toContain("agent change");
    expect(prepared.diff).not.toContain("user staged");
    try {
      prepared.commit("test: isolated agent change");
    } finally {
      prepared.dispose();
    }

    expect(
      execFileSync("git", ["show", "--format=", "--name-only", "HEAD"], {
        cwd,
        encoding: "utf8",
      }).trim(),
    ).toBe("agent.txt");
    expect(
      execFileSync("git", ["diff", "--cached", "--name-only"], {
        cwd,
        encoding: "utf8",
      }).trim(),
    ).toBe("user.txt");
    expect(readFileSync(join(cwd, "user.txt"), "utf8")).toBe("user staged\n");
  });

  it("fails closed when a user-staged path overlaps an Orbit path", () => {
    writeFileSync(join(cwd, "agent.txt"), "user staged version\n", "utf8");
    execFileSync("git", ["add", "agent.txt"], { cwd });
    writeFileSync(join(cwd, "agent.txt"), "later working version\n", "utf8");

    expect(() => prepareIsolatedGitCommit(cwd, ["agent.txt"])).toThrow(
      /user-staged changes overlap/i,
    );
    expect(
      execFileSync("git", ["show", ":agent.txt"], {
        cwd,
        encoding: "utf8",
      }),
    ).toBe("user staged version\n");
  });

  it("rejects paths outside the workspace", () => {
    expect(() => prepareIsolatedGitCommit(cwd, ["../outside.txt"])).toThrow(
      /outside workspace boundary/i,
    );
  });
});
