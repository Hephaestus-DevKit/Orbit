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
  buildAcceptanceSummary,
  loadAcceptanceSuite,
  writeAcceptanceVerificationContract,
} from "./eval.js";
import type { AcceptanceTaskResult } from "@orbit-build/core";

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
      metadata: { version: "1", deterministic: true, tags: [] },
      tasks: [{ id: "inspect", mode: "single", verification: [] }],
    });
  });

  it("keeps the checked-in cross-language baseline schema-valid", () => {
    const suite = loadAcceptanceSuite(process.cwd(), "evals/deepseek-v4.yaml");

    expect(suite.tasks).toHaveLength(8);
    expect(suite.metadata).toMatchObject({
      version: "2026-08-15",
      deterministic: true,
      tags: ["deepseek", "coding", "cross-language"],
    });
    expect(suite.tasks.map((task) => task.id)).toEqual(
      expect.arrayContaining([
        "repair-python-unit-conversion",
        "harden-path-boundary",
        "repair-async-cancellation",
        "migrate-session-schema",
        "migrate-batch-normalization-api",
        "resolve-calculator-conflict",
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

  it("aggregates completion, reliability, and unintended-change evidence", () => {
    const results = [
      {
        passed: true,
        agentStatus: "completed",
        durationMs: 100,
        checks: [{ passed: true }],
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 5 },
        reliability: { approvalRequests: 1, toolFailures: 0 },
        failureReasons: [],
      },
      {
        passed: false,
        agentStatus: "aborted",
        durationMs: 300,
        checks: [{ passed: false }],
        usage: { inputTokens: 20, outputTokens: 6, cacheReadTokens: 2 },
        reliability: { approvalRequests: 2, toolFailures: 1 },
        failureReasons: ["forbidden_file_changed:.env"],
      },
    ] as unknown as AcceptanceTaskResult[];

    expect(buildAcceptanceSummary(results)).toMatchObject({
      completionRate: 0.5,
      verificationPassRate: 0.5,
      crashOrAbortRate: 0.5,
      medianDurationMs: 200,
      totalInputTokens: 30,
      totalOutputTokens: 10,
      totalCacheReadTokens: 7,
      totalApprovalRequests: 3,
      totalToolFailures: 1,
      unintendedFileChangeFindings: 1,
    });
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
