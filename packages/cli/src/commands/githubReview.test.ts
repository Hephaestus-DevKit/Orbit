import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGithubCheckRunPayload, runGithubReview } from "./githubReview.js";
import type { ReviewArtifact } from "./review.js";

const artifact: ReviewArtifact = {
  schemaVersion: 1,
  perspective: "security",
  reviewedAt: "2026-08-16T00:00:00.000Z",
  verdict: "rejected",
  feedback: "One unsafe path remains.",
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
    {
      id: "old-1",
      severity: "P0",
      title: "Already fixed",
      file: "C:\\workspace\\src\\b.ts",
      line: 2,
      evidence: "old issue",
      impact: "none",
      remediation: "keep regression test",
      disposition: "fixed",
    },
  ],
};

describe("GitHub review adapter", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-github-review-"));
    mkdirSync(join(cwd, ".orbit", "reviews"), { recursive: true });
    writeFileSync(
      join(cwd, ".orbit", "reviews", "security.json"),
      JSON.stringify(artifact),
    );
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("builds bounded annotations and only open P0/P1 findings block", () => {
    const payload = buildGithubCheckRunPayload([artifact], {
      name: "Orbit Review",
      sha: "a".repeat(40),
    });
    expect(payload.conclusion).toBe("failure");
    expect(payload.output.annotations).toHaveLength(2);
    expect(payload.output.annotations[0]).toMatchObject({
      path: "src/a.ts",
      start_line: 10,
      annotation_level: "failure",
    });
    expect(payload.output.annotations[1].path).toBe("b.ts");
  });

  it("defaults to a dry-run and never reads a token", async () => {
    const fetchImplementation = vi.fn();
    const write = vi.fn();
    const result = await runGithubReview(
      cwd,
      {
        repo: "octo/orbit",
        sha: "b".repeat(40),
        json: true,
      },
      { fetchImplementation, env: { GITHUB_TOKEN: "ghs_secret" }, write },
    );
    expect(result.applied).toBe(false);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(JSON.stringify(write.mock.calls[0][0])).not.toContain("ghs_secret");
  });

  it("publishes only with --apply and redacts failures", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 42, html_url: "https://github.com/check/42" }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const write = vi.fn();
    const result = await runGithubReview(
      cwd,
      {
        repo: "octo/orbit",
        sha: "c".repeat(40),
        apply: true,
        json: true,
      },
      { fetchImplementation, env: { GITHUB_TOKEN: "ghs_secret" }, write },
    );
    expect(result).toMatchObject({
      applied: true,
      response: { id: 42 },
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.github.com/repos/octo/orbit/check-runs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer ghs_secret",
        }),
      }),
    );
    expect(String(write.mock.calls[0][0])).not.toContain("ghs_secret");
  });

  it("rejects custom API hosts unless explicitly allowed", async () => {
    await expect(
      runGithubReview(cwd, {
        repo: "octo/orbit",
        sha: "d".repeat(40),
        apiBaseUrl: "https://enterprise.example/api/v3",
      }),
    ).rejects.toThrow("allowCustomApi");
  });

  it("verifies a PR head before creating a Check Run", async () => {
    const sha = "e".repeat(40);
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ head: { sha } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 7 }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    const result = await runGithubReview(
      cwd,
      {
        repo: "octo/orbit",
        sha,
        pullRequest: 42,
        apply: true,
        json: true,
      },
      {
        fetchImplementation,
        env: { GITHUB_TOKEN: "ghs_secret" },
        write: vi.fn(),
      },
    );
    expect(result).toMatchObject({ applied: true, pullRequest: 42 });
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/octo/orbit/pulls/42",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/octo/orbit/check-runs",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
