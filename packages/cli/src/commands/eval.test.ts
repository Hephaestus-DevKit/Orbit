import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadAcceptanceSuite,
  writeAcceptanceVerificationContract,
} from "./eval.js";

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

  it("materializes reviewed commands as an isolated verification contract", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-eval-contract-"));
    roots.push(cwd);
    const suite = loadAcceptanceSuite(process.cwd(), "evals/deepseek-v4.yaml");
    const task = suite.tasks[0];

    const contractPath = writeAcceptanceVerificationContract(cwd, task);

    expect(resolve(contractPath!)).toBe(
      resolve(cwd, ".orbit", "verification.json"),
    );
    expect(JSON.parse(readFileSync(contractPath!, "utf8"))).toEqual({
      suites: {
        "01-invoice verifier":
          "node evals/fixtures/invoice-rounding/verify.mjs",
      },
      maxRepairAttempts: 3,
    });
  });

  it("does not create a contract for observation-only acceptance tasks", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-eval-no-contract-"));
    roots.push(cwd);
    const suite = loadAcceptanceSuite(cwd, createReadOnlySuite(cwd));

    expect(
      writeAcceptanceVerificationContract(cwd, suite.tasks[0]),
    ).toBeUndefined();
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

function createReadOnlySuite(cwd: string): string {
  const fileName = "read-only.yaml";
  writeFileSync(
    join(cwd, fileName),
    [
      "schemaVersion: 1",
      "name: read-only",
      "tasks:",
      "  - id: inspect",
      "    prompt: Inspect the project.",
    ].join("\n"),
    "utf8",
  );
  return fileName;
}
