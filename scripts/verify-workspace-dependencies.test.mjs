import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findWorkspaceDependencyFailures } from "./verify-workspace-dependencies.mjs";

describe("workspace dependency verification", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "orbit-dependencies-"));
    mkdirSync(join(root, "packages", "example", "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeProject(manifest, sources) {
    const projectPath = join(root, "packages", "example");
    writeFileSync(
      join(projectPath, "package.json"),
      `${JSON.stringify(manifest, undefined, 2)}\n`,
      "utf8",
    );
    for (const [fileName, source] of Object.entries(sources)) {
      writeFileSync(join(projectPath, "src", fileName), source, "utf8");
    }
  }

  it("accepts declared imports and ignores built-ins, relative files, and tests", () => {
    writeProject(
      {
        name: "example",
        dependencies: { zod: "^3.23.8" },
      },
      {
        "index.ts": [
          'import { readFile } from "node:fs/promises";',
          'import { z } from "zod";',
          'import { helper } from "./helper.js";',
          "export const schema = z.string();",
          "void readFile;",
          "void helper;",
        ].join("\n"),
        "helper.ts": "export const helper = true;\n",
        "index.test.ts": 'import "test-only-package";\n',
      },
    );

    expect(findWorkspaceDependencyFailures(root, ["packages"])).toEqual([]);
  });

  it("reports missing declarations and unused runtime dependencies", () => {
    writeProject(
      {
        name: "example",
        dependencies: { zod: "^3.23.8" },
      },
      {
        "index.ts": 'import "undici";\n',
      },
    );

    expect(findWorkspaceDependencyFailures(root, ["packages"])).toEqual([
      "example: missing declaration for undici (imported by packages/example/src/index.ts)",
      "example: unused runtime dependency zod",
    ]);
  });
});
