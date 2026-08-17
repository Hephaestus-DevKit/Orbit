import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { FleetFilePersistence } from "./FleetFilePersistence.js";

describe("FleetFilePersistence", () => {
  it("round-trips bounded records atomically", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-fleet-file-"));
    try {
      const persistence = new FleetFilePersistence(root);
      expect(persistence.load()).toEqual([]);
      const record = {
        schemaVersion: 1 as const,
        id: "job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
        originId: "desktop",
        workspaceRef: "ws:demo",
        prompt: "hello",
        state: "queued" as const,
        attempt: 1,
        maxAttempts: 3,
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
      };
      persistence.save([record]);
      expect(persistence.load()).toEqual([record]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked persistence file", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-fleet-file-"));
    try {
      const target = join(root, "outside.json");
      const link = join(root, "fleet", "jobs.json");
      mkdirSync(join(root, "fleet"), { recursive: true });
      expect(() => {
        // The parent is intentionally created only after constructing the
        // safe path so the persistence adapter owns its normal directory.
        symlinkSync(target, link, "file");
        new FleetFilePersistence(root).save([]);
      }).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
