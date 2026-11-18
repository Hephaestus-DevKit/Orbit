import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";
import { runClean } from "./clean.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("runClean", () => {
  it("previews without deleting when confirmation is rejected", async () => {
    const { home, project } = createFixture();
    const write = vi.fn();
    const result = await runClean(
      project,
      { project: true },
      {
        homeDirectory: home,
        interactive: true,
        confirm: async () => false,
        write,
      },
    );

    expect(result.applied).toBe(false);
    expect(existsSync(join(project, ".orbit"))).toBe(true);
    expect(write.mock.calls.flat().join("\n")).toContain("cleanup preview");
  });

  it("requires explicit authorization in a non-interactive terminal", async () => {
    const { home, project } = createFixture();
    await expect(
      runClean(
        project,
        { user: true },
        { homeDirectory: home, interactive: false, write: vi.fn() },
      ),
    ).rejects.toThrow("--yes");
    expect(existsSync(join(home, ".orbit"))).toBe(true);
  });

  it("applies all scopes with --yes and emits one JSON result", async () => {
    const { home, project } = createFixture();
    const output: string[] = [];
    const purgeUserCredentials = vi.fn();
    const result = await runClean(
      project,
      { all: true, yes: true, json: true },
      {
        homeDirectory: home,
        write: (text) => output.push(text),
        purgeUserCredentials,
      },
    );

    expect(result.applied).toBe(true);
    expect(result.removed).toHaveLength(2);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({
      schemaVersion: 1,
      applied: true,
    });
    expect(existsSync(join(home, ".orbit"))).toBe(false);
    expect(existsSync(join(project, ".orbit"))).toBe(false);
    expect(purgeUserCredentials).toHaveBeenCalledWith(join(home, ".orbit"));
  });

  it("uses JSON without --yes as a non-destructive preview", async () => {
    const { home, project } = createFixture();
    const output: string[] = [];
    const result = await runClean(
      project,
      { project: true, json: true },
      {
        homeDirectory: home,
        interactive: false,
        write: (text) => output.push(text),
      },
    );

    expect(result.applied).toBe(false);
    expect(JSON.parse(output[0])).toMatchObject({ applied: false });
    expect(existsSync(join(project, ".orbit"))).toBe(true);
  });
});

function createFixture(): { home: string; project: string } {
  const root = mkdtempSync(join(tmpdir(), "orbit-clean-command-"));
  temporaryPaths.push(root);
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(join(home, ".orbit"), { recursive: true });
  mkdirSync(join(project, ".orbit", "sessions"), { recursive: true });
  writeFileSync(join(home, ".orbit", "providers.json"), "{}");
  writeFileSync(join(project, ".orbit", "sessions", "chat.json"), "{}");
  return { home, project };
}
