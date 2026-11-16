import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  allowedPackageImports,
  findBrowserScriptBudgetFailures,
  findArchitectureFailures,
  findHotspotBudgetFailures,
} from "./verify-architecture.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("architecture contract", () => {
  it("keeps the current workspace dependency direction valid", () => {
    expect(findArchitectureFailures(repositoryRoot)).toEqual([]);
  });

  it("does not allow presentation or orchestration layers below shared", () => {
    expect(allowedPackageImports["@orbit-build/shared"]).toEqual([]);
    expect(allowedPackageImports["@orbit-build/tui"]).toEqual([]);
    expect(allowedPackageImports["@orbit-build/core"]).not.toContain(
      "@orbit-build/cli",
    );
  });

  it("keeps reviewed hotspot files from growing without an extraction review", () => {
    expect(findHotspotBudgetFailures(repositoryRoot)).toEqual([]);
  });
});

describe("browser type migration budget", () => {
  it("allows the current typed controllers and bounded legacy shell", () => {
    expect(findBrowserScriptBudgetFailures(repositoryRoot)).toEqual([]);
  });
  it("rejects a new unchecked browser script", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-browser-budget-"));
    try {
      const directory = join(
        root,
        "packages",
        "cli",
        "src",
        "runtime",
        "webui",
      );
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "WebUiClientUnsafe.ts"),
        "export const SCRIPT = String.raw`function unchecked(value) { return value.missing; }`;\n",
      );
      expect(findBrowserScriptBudgetFailures(root)).toEqual([
        expect.stringContaining("strictly typed browser controller"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
