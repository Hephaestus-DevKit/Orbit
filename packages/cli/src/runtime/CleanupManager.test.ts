import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, parse } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCleanupPlan, executeCleanupPlan } from "./CleanupManager.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("CleanupManager", () => {
  it("inventories user and project data without including project files", () => {
    const root = createTemporaryRoot();
    const home = join(root, "home");
    const project = join(root, "project");
    mkdirSync(join(home, ".orbit"), { recursive: true });
    mkdirSync(join(project, ".orbit", "sessions"), { recursive: true });
    writeFileSync(join(home, ".orbit", "providers.json"), "profiles");
    writeFileSync(join(project, ".orbit", "sessions", "chat.json"), "chat");
    writeFileSync(join(project, "source.ts"), "keep");

    const plan = buildCleanupPlan({
      cwd: project,
      homeDirectory: home,
      scopes: ["user", "project"],
    });

    expect(plan.targets).toHaveLength(2);
    expect(plan.totals.files).toBe(2);
    expect(plan.targets.map((target) => target.path)).not.toContain(
      join(project, "source.ts"),
    );
  });

  it("removes only .orbit directories and preserves project-owned files", () => {
    const root = createTemporaryRoot();
    const home = join(root, "home");
    const project = join(root, "project");
    mkdirSync(join(home, ".orbit"), { recursive: true });
    mkdirSync(join(project, ".orbit"), { recursive: true });
    writeFileSync(join(project, "ORBIT.md"), "keep");
    writeFileSync(join(project, "orbit.config.yaml"), "keep: true");

    const result = executeCleanupPlan(
      buildCleanupPlan({
        cwd: project,
        homeDirectory: home,
        scopes: ["user", "project"],
      }),
    );

    expect(result.removed).toHaveLength(2);
    expect(existsSync(join(home, ".orbit"))).toBe(false);
    expect(existsSync(join(project, ".orbit"))).toBe(false);
    expect(existsSync(join(project, "ORBIT.md"))).toBe(true);
    expect(existsSync(join(project, "orbit.config.yaml"))).toBe(true);
  });

  it("deduplicates coincident user and project data targets", () => {
    const home = createTemporaryRoot();
    mkdirSync(join(home, ".orbit"), { recursive: true });
    const plan = buildCleanupPlan({
      cwd: home,
      homeDirectory: home,
      scopes: ["user", "project"],
    });

    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].scopes).toEqual(["user", "project"]);
  });

  it("removes a linked .orbit entry without touching its target", () => {
    const root = createTemporaryRoot();
    const project = join(root, "project");
    const outside = join(root, "outside");
    mkdirSync(project);
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "keep");
    symlinkSync(
      outside,
      join(project, ".orbit"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = executeCleanupPlan(
      buildCleanupPlan({ cwd: project, scopes: ["project"] }),
    );

    expect(result.removed).toEqual([join(project, ".orbit")]);
    expect(existsSync(join(project, ".orbit"))).toBe(false);
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
  });

  it("rejects cleanup through a link to a filesystem root", () => {
    const root = createTemporaryRoot();
    const linkedRoot = join(root, "linked-root");
    symlinkSync(
      parse(root).root,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() =>
      buildCleanupPlan({
        cwd: linkedRoot,
        projectDirectory: linkedRoot,
        scopes: ["project"],
      }),
    ).toThrow("filesystem-root link");
  });

  it("skips a target that disappeared after preview", () => {
    const root = createTemporaryRoot();
    const project = join(root, "project");
    mkdirSync(join(project, ".orbit"), { recursive: true });
    const plan = buildCleanupPlan({ cwd: project, scopes: ["project"] });
    rmSync(join(project, ".orbit"), { recursive: true, force: true });

    expect(executeCleanupPlan(plan)).toEqual({
      removed: [],
      skipped: [join(project, ".orbit")],
    });
  });
});

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "orbit-cleanup-"));
  temporaryPaths.push(root);
  return root;
}
