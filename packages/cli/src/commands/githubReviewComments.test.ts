import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGithubReviewComments } from "./githubReviewComments.js";

describe("GitHub inline review comments", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-github-comments-"));
    mkdirSync(join(cwd, ".orbit", "reviews"), { recursive: true });
    writeFileSync(
      join(cwd, ".orbit", "reviews", "security.json"),
      JSON.stringify({
        schemaVersion: 1,
        perspective: "security",
        reviewedAt: "2026-08-16T00:00:00.000Z",
        verdict: "rejected",
        feedback: "Unsafe path",
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

  const options = {
    repo: "octo/orbit",
    pullRequest: 42,
    sha: "a".repeat(40),
    json: true,
  };

  it("creates an idempotent dry-run plan without reading a token", async () => {
    const fetchImplementation = vi.fn();
    const write = vi.fn();
    const result = await runGithubReviewComments(cwd, options, {
      fetchImplementation,
      env: { GITHUB_TOKEN: "ghs_secret" },
      write,
    });
    expect(result).toMatchObject({
      applied: false,
      planned: [{ path: "src/a.ts", line: 10 }],
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(String(write.mock.calls[0][0])).not.toContain("ghs_secret");
  });

  it("skips an existing Orbit marker and does not duplicate comments", async () => {
    const marker = "<!-- orbit-finding:security.json:path-1 -->";
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          JSON.stringify([{ body: `${marker}\nprevious comment` }]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const result = await runGithubReviewComments(
      cwd,
      { ...options, apply: true },
      {
        fetchImplementation,
        env: { GITHUB_TOKEN: "ghs_secret" },
        write: vi.fn(),
      },
    );
    expect(result).toMatchObject({
      applied: true,
      created: [],
      skippedExisting: [marker],
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("publishes only missing comments after explicit apply", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 99 }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    const result = await runGithubReviewComments(
      cwd,
      { ...options, apply: true },
      {
        fetchImplementation,
        env: { GITHUB_TOKEN: "ghs_secret" },
        write: vi.fn(),
      },
    );
    expect(result.created).toEqual([
      "<!-- orbit-finding:security.json:path-1 -->",
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/octo/orbit/pulls/42/comments",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"commit_id"'),
      }),
    );
  });

  it("rejects traversal and absolute paths instead of guessing a basename", async () => {
    writeFileSync(
      join(cwd, ".orbit", "reviews", "unsafe.json"),
      JSON.stringify({
        schemaVersion: 1,
        perspective: "security",
        reviewedAt: "2026-08-16T00:00:00.000Z",
        verdict: "rejected",
        feedback: "unsafe paths",
        findings: [
          {
            id: "traversal",
            severity: "P1",
            title: "Traversal",
            file: "../../outside.ts",
            line: 4,
            evidence: "..",
            impact: "escape",
            remediation: "reject",
            disposition: "open",
          },
          {
            id: "absolute",
            severity: "P1",
            title: "Absolute",
            file: "C:\\workspace\\src\\b.ts",
            line: 5,
            evidence: "absolute",
            impact: "escape",
            remediation: "reject",
            disposition: "open",
          },
        ],
      }),
    );
    const result = await runGithubReviewComments(cwd, {
      ...options,
      artifact: "unsafe.json",
      json: true,
    });
    expect(result.planned).toEqual([]);
    expect(result.skippedInvalid).toHaveLength(2);
  });

  it("paginates existing comments and stops before publishing when the list is unsafe", async () => {
    const marker = "<!-- orbit-finding:security.json:path-1 -->";
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      body: index === 99 ? marker : "ordinary comment",
    }));
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(fullPage), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const result = await runGithubReviewComments(
      cwd,
      { ...options, apply: true },
      {
        fetchImplementation,
        env: { GITHUB_TOKEN: "ghs_secret" },
        write: vi.fn(),
      },
    );
    expect(result.skippedExisting).toEqual([marker]);
    expect(result.created).toEqual([]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/octo/orbit/pulls/42/comments?per_page=100&page=2",
      expect.anything(),
    );
  });

  it("fails closed when pagination never terminates", async () => {
    const fullPage = Array.from({ length: 100 }, () => ({ body: "ordinary" }));
    const fetchImplementation = vi.fn(
      async () =>
        new Response(JSON.stringify(fullPage), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      runGithubReviewComments(
        cwd,
        { ...options, apply: true },
        {
          fetchImplementation,
          env: { GITHUB_TOKEN: "ghs_secret" },
          write: vi.fn(),
        },
      ),
    ).rejects.toThrow(/safety limit/);
    expect(fetchImplementation).toHaveBeenCalledTimes(10);
  });

  it("redacts opaque token values from API failures", async () => {
    const token = "opaque-token-value";
    const fetchImplementation = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: `echo ${token}` }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      runGithubReviewComments(
        cwd,
        { ...options, apply: true },
        { fetchImplementation, env: { GITHUB_TOKEN: token }, write: vi.fn() },
      ),
    ).rejects.toThrow(/\*\*\*REDACTED\*\*\*/);
    await expect(
      runGithubReviewComments(
        cwd,
        { ...options, apply: true },
        { fetchImplementation, env: { GITHUB_TOKEN: token }, write: vi.fn() },
      ),
    ).rejects.not.toThrow(token);
  });
});
