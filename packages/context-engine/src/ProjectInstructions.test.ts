import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadProjectInstructions } from "./ProjectInstructions.js";

describe("project instruction loading", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  it("combines dedicated conventions in deterministic order and labels provenance", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-instructions-"));
    roots.push(root);
    mkdirSync(join(root, ".helix"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "agent rule", "utf8");
    writeFileSync(join(root, "CLAUDE.md"), "claude rule", "utf8");
    writeFileSync(
      join(root, ".helix", "instructions.md"),
      "helix rule",
      "utf8",
    );

    const result = loadProjectInstructions(root);
    expect(result.indexOf("AGENTS.md")).toBeLessThan(
      result.indexOf("CLAUDE.md"),
    );
    expect(result.indexOf("CLAUDE.md")).toBeLessThan(
      result.indexOf(".helix/instructions.md"),
    );
    expect(result).toContain("agent rule");
    expect(result).toContain("helix rule");
    expect(result).toMatch(/^## Orbit instruction source: AGENTS\.md/m);
  });

  it("uses README only when no dedicated instruction file exists", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-instructions-readme-"));
    roots.push(root);
    writeFileSync(join(root, "README.md"), "readme guidance", "utf8");
    expect(loadProjectInstructions(root)).toContain("readme guidance");

    writeFileSync(join(root, "AGENTS.md"), "dedicated guidance", "utf8");
    const result = loadProjectInstructions(root);
    expect(result).toContain("dedicated guidance");
    expect(result).not.toContain("readme guidance");
  });

  it("loads nested instructions only for relevant workspace paths", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-instructions-scoped-"));
    roots.push(root);
    mkdirSync(join(root, "packages", "billing"), { recursive: true });
    writeFileSync(
      join(root, "packages", "billing", "AGENTS.md"),
      "billing module rule",
      "utf8",
    );
    writeFileSync(join(root, "README.md"), "readme guidance", "utf8");

    const result = loadProjectInstructions(root, [
      "packages/billing/src/invoice.ts",
    ]);
    expect(result).toContain("billing module rule");
    expect(result).not.toContain("readme guidance");
    expect(result).toContain("packages/billing/AGENTS.md");
  });
});
