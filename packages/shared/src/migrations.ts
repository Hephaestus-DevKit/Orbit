import { z } from "zod";

const SchemaVersionSchema = z.number().int().nonnegative().safe();

export type MigrationErrorCode =
  | "invalid_registration"
  | "missing_version"
  | "invalid_version"
  | "future_version"
  | "missing_step"
  | "invalid_step_output";

export class MigrationError extends Error {
  constructor(
    public readonly code: MigrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface MigrationStep {
  readonly from: number;
  readonly to: number;
  readonly migrate: (value: unknown) => unknown;
}

export interface MigrationRegistryOptions<T> {
  readonly name: string;
  readonly currentVersion: number;
  readonly schema: { parse(value: unknown): T };
  /** Version assigned to a payload that predates explicit schemaVersion. */
  readonly legacyVersion?: number;
}

export interface MigrationResult<T> {
  readonly data: T;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly applied: readonly string[];
}

/**
 * Upgrade one bounded, versioned persistence payload through explicit,
 * contiguous steps and validate the final representation.
 */
export class MigrationRegistry<T> {
  private readonly steps = new Map<number, MigrationStep>();
  private readonly name: string;
  private readonly currentVersion: number;
  private readonly schema: { parse(value: unknown): T };
  private readonly legacyVersion?: number;

  constructor(options: MigrationRegistryOptions<T>) {
    this.name = z.string().trim().min(1).max(120).parse(options.name);
    this.currentVersion = SchemaVersionSchema.parse(options.currentVersion);
    this.schema = options.schema;
    this.legacyVersion =
      options.legacyVersion === undefined
        ? undefined
        : SchemaVersionSchema.parse(options.legacyVersion);
    if (
      this.legacyVersion !== undefined &&
      this.legacyVersion > this.currentVersion
    ) {
      throw new MigrationError(
        "invalid_registration",
        `${this.name} legacy schema version cannot exceed the current version.`,
      );
    }
  }

  /** Register exactly one forward step; branching and skipped versions fail. */
  public register(step: MigrationStep): this {
    const from = SchemaVersionSchema.parse(step.from);
    const to = SchemaVersionSchema.parse(step.to);
    if (to !== from + 1) {
      throw new MigrationError(
        "invalid_registration",
        `${this.name} migration must advance exactly one version (${from} -> ${to}).`,
      );
    }
    if (to > this.currentVersion) {
      throw new MigrationError(
        "invalid_registration",
        `${this.name} migration ${from} -> ${to} exceeds current version ${this.currentVersion}.`,
      );
    }
    if (this.steps.has(from)) {
      throw new MigrationError(
        "invalid_registration",
        `${this.name} migration from version ${from} is already registered.`,
      );
    }
    this.steps.set(from, { ...step, from, to });
    return this;
  }

  /** Migrate without mutating caller-owned input and return an audit receipt. */
  public migrate(value: unknown): MigrationResult<T> {
    const fromVersion = this.readVersion(value);
    if (fromVersion > this.currentVersion) {
      throw new MigrationError(
        "future_version",
        `${this.name} schema version ${fromVersion} is newer than supported version ${this.currentVersion}.`,
      );
    }

    let working = structuredClone(value);
    const applied: string[] = [];
    let version = fromVersion;
    while (version < this.currentVersion) {
      const step = this.steps.get(version);
      if (!step) {
        throw new MigrationError(
          "missing_step",
          `${this.name} has no migration from schema version ${version}.`,
        );
      }
      working = step.migrate(structuredClone(working));
      const actualVersion = this.readExplicitVersion(working);
      if (actualVersion !== step.to) {
        throw new MigrationError(
          "invalid_step_output",
          `${this.name} migration ${step.from} -> ${step.to} produced schema version ${actualVersion}.`,
        );
      }
      applied.push(`${step.from}->${step.to}`);
      version = step.to;
    }

    return {
      data: this.schema.parse(working),
      fromVersion,
      toVersion: this.currentVersion,
      applied: Object.freeze(applied),
    };
  }

  /** Validate or migrate and return only the current representation. */
  public parse(value: unknown): T {
    return this.migrate(value).data;
  }

  private readVersion(value: unknown): number {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !("schemaVersion" in value)
    ) {
      if (this.legacyVersion !== undefined) return this.legacyVersion;
      throw new MigrationError(
        "missing_version",
        `${this.name} payload is missing schemaVersion.`,
      );
    }
    return this.readExplicitVersion(value);
  }

  private readExplicitVersion(value: unknown): number {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !("schemaVersion" in value)
    ) {
      throw new MigrationError(
        "missing_version",
        `${this.name} payload is missing schemaVersion.`,
      );
    }
    const parsed = SchemaVersionSchema.safeParse(value.schemaVersion);
    if (!parsed.success) {
      throw new MigrationError(
        "invalid_version",
        `${this.name} schemaVersion must be a non-negative integer.`,
      );
    }
    return parsed.data;
  }
}
