import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { validateExtension } from "./extension.js";

describe("extension command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a machine-readable validated manifest", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-extension-cli-"));
    try {
      writeFileSync(
        join(cwd, "orbit.extension.json"),
        JSON.stringify({
          schemaVersion: 1,
          id: "com.example.cli",
          displayName: "CLI example",
          version: "1.0.0",
          orbit: { minVersion: "0.1.7" },
        }),
      );
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const manifest = validateExtension(cwd, "orbit.extension.json", {
        json: true,
      });

      expect(manifest.id).toBe("com.example.cli");
      expect(JSON.parse(String(log.mock.calls[0][0])).schemaVersion).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
