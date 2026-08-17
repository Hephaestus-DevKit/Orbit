import { describe, expect, it, vi } from "vitest";
import {
  parseGithubDispatchInputs,
  runGithubDispatch,
} from "./githubDispatch.js";

describe("GitHub workflow dispatch adapter", () => {
  const options = {
    repo: "octo/orbit",
    workflow: "ci.yml",
    ref: "feature/1",
    inputs: { suite: "critical", reason: "review" },
    json: true,
  };

  it("builds a bounded dry-run without reading a token", async () => {
    const fetchImplementation = vi.fn();
    const write = vi.fn();
    const result = await runGithubDispatch(options, {
      fetchImplementation,
      env: { GITHUB_TOKEN: "opaque-token" },
      write,
    });
    expect(result).toMatchObject({
      applied: false,
      endpoint:
        "https://api.github.com/repos/octo/orbit/actions/workflows/ci.yml/dispatches",
      ref: "feature/1",
      inputs: options.inputs,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(String(write.mock.calls[0][0])).not.toContain("opaque-token");
  });

  it("posts only after explicit apply and accepts GitHub's empty 204 response", async () => {
    const fetchImplementation = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const result = await runGithubDispatch(
      { ...options, apply: true },
      {
        fetchImplementation,
        env: { GITHUB_TOKEN: "ghs_secret" },
        write: vi.fn(),
      },
    );
    expect(result).toMatchObject({ applied: true, responseStatus: 204 });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.github.com/repos/octo/orbit/actions/workflows/ci.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ref: "feature/1", inputs: options.inputs }),
        headers: expect.objectContaining({
          Authorization: "Bearer ghs_secret",
        }),
      }),
    );
  });

  it("parses repeatable inputs and rejects malformed or duplicate values", () => {
    expect(parseGithubDispatchInputs(["a=1", "b=two=parts"])).toEqual({
      a: "1",
      b: "two=parts",
    });
    expect(() => parseGithubDispatchInputs(["missing-separator"])).toThrow(
      /name=value/,
    );
    expect(() => parseGithubDispatchInputs(["a=1", "a=2"])).toThrow(
      /provided more than once/,
    );
  });

  it("rejects unsafe workflow identifiers and custom hosts without opt-in", async () => {
    await expect(
      runGithubDispatch({ ...options, workflow: "../ci.yml" }),
    ).rejects.toThrow(/simple .yml/);
    await expect(
      runGithubDispatch({
        ...options,
        apiBaseUrl: "https://enterprise.example/api/v3",
      }),
    ).rejects.toThrow(/allowCustomApi/);
  });

  it("bounds and redacts API failures", async () => {
    const token = "opaque-token-value";
    const fetchImplementation = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: `echo ${token}` }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      runGithubDispatch(
        { ...options, apply: true },
        { fetchImplementation, env: { GITHUB_TOKEN: token }, write: vi.fn() },
      ),
    ).rejects.toThrow(/\*\*\*REDACTED\*\*\*/);
  });
});
