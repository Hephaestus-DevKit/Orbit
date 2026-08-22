import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MigrationError, MigrationRegistry } from "./migrations.js";

const CurrentSchema = z.object({
  schemaVersion: z.literal(2),
  label: z.string(),
  enabled: z.boolean(),
});

function createRegistry(): MigrationRegistry<z.infer<typeof CurrentSchema>> {
  return new MigrationRegistry({
    name: "Fixture",
    currentVersion: 2,
    legacyVersion: 0,
    schema: CurrentSchema,
  })
    .register({
      from: 0,
      to: 1,
      migrate: (value) => ({
        ...(value as Record<string, unknown>),
        schemaVersion: 1,
        enabled: true,
      }),
    })
    .register({
      from: 1,
      to: 2,
      migrate: (value) => ({
        ...(value as Record<string, unknown>),
        schemaVersion: 2,
      }),
    });
}

describe("MigrationRegistry", () => {
  it("applies contiguous migrations without mutating legacy input", () => {
    const legacy = { label: "stable" };

    const result = createRegistry().migrate(legacy);

    expect(result).toEqual({
      data: { schemaVersion: 2, label: "stable", enabled: true },
      fromVersion: 0,
      toVersion: 2,
      applied: ["0->1", "1->2"],
    });
    expect(legacy).toEqual({ label: "stable" });
    expect(Object.isFrozen(result.applied)).toBe(true);
  });

  it("validates current payloads without applying a step", () => {
    expect(
      createRegistry().migrate({
        schemaVersion: 2,
        label: "current",
        enabled: false,
      }),
    ).toMatchObject({ fromVersion: 2, toVersion: 2, applied: [] });
  });

  it("rejects future versions, missing steps, and invalid step output", () => {
    try {
      createRegistry().parse({
        schemaVersion: 3,
        label: "future",
        enabled: true,
      });
      throw new Error("Expected a future-version rejection.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).code).toBe("future_version");
    }

    const missing = new MigrationRegistry({
      name: "Missing",
      currentVersion: 1,
      legacyVersion: 0,
      schema: z.object({ schemaVersion: z.literal(1) }),
    });
    expect(() => missing.parse({})).toThrow(/no migration/);

    const invalid = new MigrationRegistry({
      name: "Invalid",
      currentVersion: 1,
      legacyVersion: 0,
      schema: z.object({ schemaVersion: z.literal(1) }),
    }).register({ from: 0, to: 1, migrate: () => ({ schemaVersion: 0 }) });
    expect(() => invalid.parse({})).toThrow(/produced schema version 0/);
  });

  it("rejects ambiguous or non-contiguous registration", () => {
    const registry = new MigrationRegistry({
      name: "Strict",
      currentVersion: 2,
      schema: CurrentSchema,
    });
    expect(() =>
      registry.register({ from: 0, to: 2, migrate: (value) => value }),
    ).toThrow(/exactly one version/);
    registry.register({ from: 1, to: 2, migrate: (value) => value });
    expect(() =>
      registry.register({ from: 1, to: 2, migrate: (value) => value }),
    ).toThrow(/already registered/);
  });
});
