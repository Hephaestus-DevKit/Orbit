import { MigrationError, readBoundedRegularFile } from "@orbit-build/shared";

const SESSION_SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;
const CURRENT_SESSION_SNAPSHOT_VERSION = 1;

export interface SessionSnapshotSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
}

/** Read one bounded session snapshot and fail closed on future durable data. */
export function readValidatedSessionSnapshot<T>(
  filePath: string,
  schema: SessionSnapshotSchema<T>,
): T | undefined {
  try {
    const raw = readBoundedRegularFile(filePath, SESSION_SNAPSHOT_MAX_BYTES);
    if (raw === undefined) return undefined;
    const value: unknown = JSON.parse(raw);
    rejectFutureSnapshotVersion(value, filePath);
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch (error: unknown) {
    if (error instanceof MigrationError && error.code === "future_version") {
      throw error;
    }
    return undefined;
  }
}

function rejectFutureSnapshotVersion(value: unknown, filePath: string): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("schemaVersion" in value)
  ) {
    return;
  }
  const version = value.schemaVersion;
  if (
    typeof version === "number" &&
    Number.isSafeInteger(version) &&
    version > CURRENT_SESSION_SNAPSHOT_VERSION
  ) {
    throw new MigrationError(
      "future_version",
      `Session snapshot ${filePath} uses unsupported schema version ${version}. Upgrade Orbit before modifying this project.`,
    );
  }
}
