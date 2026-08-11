import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { workspaceAliases } from "./vitest.shared.js";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

describe("Vitest workspace aliases", () => {
  it("maps every workspace package to an existing source entry", () => {
    const packagesDirectory = join(repositoryRoot, "packages");
    const packageNames = readdirSync(packagesDirectory, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const manifestPath = join(
          packagesDirectory,
          entry.name,
          "package.json",
        );
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          name?: unknown;
        };
        if (typeof manifest.name !== "string") {
          throw new Error(
            `Workspace package is missing a name: ${manifestPath}`,
          );
        }
        return manifest.name;
      })
      .sort();

    expect(Object.keys(workspaceAliases).sort()).toEqual(packageNames);
    for (const sourcePath of Object.values(workspaceAliases)) {
      expect(existsSync(sourcePath), sourcePath).toBe(true);
    }
  });
});
