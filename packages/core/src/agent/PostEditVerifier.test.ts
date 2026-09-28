import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyEditedFile } from "./PostEditVerifier.js";
import { executeLocalPackageBinary } from "./LocalPackageBinary.js";

vi.mock("./LocalPackageBinary.js", () => ({
  executeLocalPackageBinary: vi.fn(),
}));
const roots: string[] = [];
function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-post-edit-"));
  roots.push(cwd);
  writeFileSync(join(cwd, "biome.json"), "{}");
  return {
    cwd,
    file: join(cwd, "file.ts"),
    trusted: true,
    execute: vi.fn(async () => ({ stdout: "", stderr: "" })),
  };
}
describe("post-edit verification", () => {
  afterEach(() => {
    vi.resetAllMocks();
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });
  it("never invokes project tooling without executable trust", async () => {
    expect(await verifyEditedFile({ ...setup(), trusted: false })).toEqual({
      ok: true,
    });
    expect(executeLocalPackageBinary).not.toHaveBeenCalled();
  });
  it("returns repair evidence without guessing dependencies or editing imports", async () => {
    vi.mocked(executeLocalPackageBinary).mockRejectedValue(
      new Error("Cannot find module 'missing-library'"),
    );
    const result = await verifyEditedFile(setup());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("normal tools");
    expect(executeLocalPackageBinary).toHaveBeenCalledOnce();
  });
  it("stops between formatting and lint when cancellation arrives", async () => {
    const controller = new AbortController();
    vi.mocked(executeLocalPackageBinary).mockImplementation(async () => {
      controller.abort();
      return { stdout: "", stderr: "" };
    });
    await expect(
      verifyEditedFile({ ...setup(), signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(executeLocalPackageBinary).toHaveBeenCalledOnce();
  });
});
