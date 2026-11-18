import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "../../../scripts/testing/support.mjs";
import { readRuntimePackageVersion } from "./version.js";

describe("readRuntimePackageVersion", () => {
  it("reads the manifest beside the runtime module", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-runtime-version-"));
    try {
      writeFileSync(join(root, "package.json"), '{"version":"1.2.3-beta.1"}');

      expect(
        readRuntimePackageVersion(
          pathToFileURL(join(root, "dist", "index.js")),
        ),
      ).toBe("1.2.3-beta.1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an invalid package version", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-runtime-version-"));
    try {
      writeFileSync(join(root, "package.json"), '{"version":"latest"}');

      expect(() =>
        readRuntimePackageVersion(
          pathToFileURL(join(root, "dist", "index.js")),
        ),
      ).toThrow("Unable to read the Orbit package version");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
