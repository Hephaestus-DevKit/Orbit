import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  allowedPackageImports,
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
