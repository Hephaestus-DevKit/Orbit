import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runReviewCommand } from "./review.js";

describe("review command", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-review-command-"));
    mkdirSync(join(cwd, ".orbit", "reviews"), { recursive: true });
    writeFileSync(
      join(cwd, ".orbit", "reviews", "security.json"),
      JSON.stringify({
        schemaVersion: 1,
        perspective: "security",
        reviewedAt: "2026-08-16T00:00:00.000Z",
        verdict: "rejected",
        feedback: "unsafe path",
        findings: [
          {
            id: "path-1",
            severity: "P1",
            title: "Path escape",
            file: "src/a.ts",
            line: 10,
            evidence: "resolve without boundary",
            impact: "writes outside workspace",
            remediation: "use resolveSafePath",
            disposition: "open",
          },
        ],
      }),
    );
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("lists and updates a bounded disposition artifact", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      runReviewCommand("list", undefined, undefined, { cwd, json: true }),
    ).toBe(0);
    expect(
      runReviewCommand("verify", undefined, undefined, { cwd, json: true }),
    ).toBe(1);
    expect(
      runReviewCommand("set", "security.json", "path-1", {
        cwd,
        json: true,
        disposition: "fixed",
        note: "Boundary check added in the follow-up patch.",
      }),
    ).toBe(0);
    expect(
      JSON.parse(
        readFileSync(join(cwd, ".orbit", "reviews", "security.json"), "utf8"),
      ).findings[0].disposition,
    ).toBe("fixed");
    const updated = JSON.parse(
      readFileSync(join(cwd, ".orbit", "reviews", "security.json"), "utf8"),
    );
    expect(updated.findings[0].dispositionHistory).toHaveLength(1);
    expect(updated.findings[0].dispositionHistory[0]).toMatchObject({
      from: "open",
      to: "fixed",
      actor: "orbit-review-cli",
      note: "Boundary check added in the follow-up patch.",
    });
    expect(
      runReviewCommand("verify", undefined, undefined, { cwd, json: true }),
    ).toBe(0);
    log.mockRestore();
  });

  it("rejects traversal-shaped artifact names", () => {
    expect(
      runReviewCommand("show", "../security.json", undefined, {
        cwd,
        json: true,
      }),
    ).toBe(1);
  });

  it("renders a mutation receipt instead of treating it as a review", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      runReviewCommand("set", "security.json", "path-1", {
        cwd,
        disposition: "accepted",
      }),
    ).toBe(0);
    expect(String(log.mock.calls.at(-1)?.[0])).toContain(
      "security.json:path-1 open → accepted",
    );
    log.mockRestore();
  });

  it("exports SARIF with bounded workspace-relative locations", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      runReviewCommand("export", undefined, undefined, {
        cwd,
        format: "sarif",
      }),
    ).toBe(0);
    const output = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(output.version).toBe("2.1.0");
    expect(output.runs[0].results[0]).toMatchObject({
      ruleId: "path-1",
      level: "error",
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "src/a.ts" },
            region: { startLine: 10 },
          },
        },
      ],
    });
    log.mockRestore();
  });

  it("writes an export atomically inside the workspace", () => {
    const output = join(cwd, "artifacts", "review.sarif");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      runReviewCommand("export", "security.json", undefined, {
        cwd,
        format: "sarif",
        out: "artifacts/review.sarif",
        json: true,
      }),
    ).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8")).runs).toHaveLength(1);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
      format: "sarif",
      out: "artifacts/review.sarif",
    });
    log.mockRestore();
  });
});
