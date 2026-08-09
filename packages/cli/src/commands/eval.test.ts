import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAcceptanceSuite } from "./eval.js";

describe("eval command suite boundary", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads a bounded YAML acceptance suite", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-eval-suite-"));
    roots.push(cwd);
    writeFileSync(
      join(cwd, "suite.yaml"),
      [
        "schemaVersion: 1",
        "name: smoke",
        "tasks:",
        "  - id: inspect",
        "    prompt: Inspect the project.",
      ].join("\n"),
      "utf8",
    );

    expect(loadAcceptanceSuite(cwd, "suite.yaml")).toMatchObject({
      name: "smoke",
      tasks: [{ id: "inspect", mode: "single", verification: [] }],
    });
  });

  it("keeps the checked-in cross-language baseline schema-valid", () => {
    const suite = loadAcceptanceSuite(process.cwd(), "evals/deepseek-v4.yaml");

    expect(suite.tasks).toHaveLength(6);
    expect(suite.tasks.map((task) => task.id)).toEqual(
      expect.arrayContaining([
        "repair-python-unit-conversion",
        "harden-path-boundary",
        "repair-async-cancellation",
        "migrate-session-schema",
      ]),
    );
  });

  it("rejects traversal and symbolic-link suite files", () => {
    const parent = mkdtempSync(join(tmpdir(), "orbit-eval-parent-"));
    const cwd = join(parent, "workspace");
    roots.push(parent);
    mkdirSync(cwd);
    writeFileSync(join(parent, "outside.yaml"), "schemaVersion: 1", "utf8");
    expect(() => loadAcceptanceSuite(cwd, "../outside.yaml")).toThrow(
      /workspace boundary/,
    );

    try {
      symlinkSync(join(parent, "outside.yaml"), join(cwd, "linked.yaml"));
    } catch {
      return;
    }
    expect(() => loadAcceptanceSuite(cwd, "linked.yaml")).toThrow(
      /real file|workspace boundary/,
    );
  });
});
