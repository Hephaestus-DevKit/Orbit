import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmSync,
  statSync,
} from "fs";
import { dirname, resolve } from "path";
import { z } from "zod";
import {
  ensurePrivateDirectory,
  readBoundedRegularFile,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";
import { FleetJobRecordSchema, type FleetJobRecord } from "./FleetProtocol.js";
import type { FleetCoordinatorPersistence } from "./FleetCoordinator.js";

const MAX_FLEET_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FLEET_JOBS = 10_000;
const LOCK_STALE_MS = 30_000;

const FleetFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    records: z.array(FleetJobRecordSchema).max(MAX_FLEET_JOBS),
  })
  .strict();

/** Local durable persistence adapter for one coordinator process. */
export class FleetFilePersistence implements FleetCoordinatorPersistence {
  private readonly filePath: string;
  private readonly lockPath: string;

  public constructor(rootDirectory: string, relativePath = "fleet/jobs.json") {
    const root = resolve(rootDirectory);
    this.filePath = resolveSafePath(root, relativePath);
    this.lockPath = `${this.filePath}.lock`;
  }

  public load(): FleetJobRecord[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readBoundedRegularFile(this.filePath, MAX_FLEET_FILE_BYTES);
    if (raw === undefined) return [];
    return FleetFileSchema.parse(JSON.parse(raw)).records;
  }

  public save(records: FleetJobRecord[]): void {
    const parsed = FleetFileSchema.parse({ schemaVersion: 1, records });
    const directory = dirname(this.filePath);
    ensurePrivateDirectory(directory);
    this.assertRegular(this.filePath);
    this.withLock(() => {
      replacePrivateFileAtomically(
        this.filePath,
        `${JSON.stringify(parsed, null, 2)}\n`,
      );
    });
  }

  private withLock(action: () => void): void {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    let descriptor: number | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        descriptor = openSync(
          this.lockPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        );
        break;
      } catch (error: unknown) {
        if (!isAlreadyExists(error)) throw error;
        if (isStaleLock(this.lockPath)) rmSync(this.lockPath, { force: true });
        else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    if (descriptor === undefined)
      throw new Error("Fleet persistence is busy in another process.");
    try {
      action();
    } finally {
      closeSync(descriptor);
      rmSync(this.lockPath, { force: true });
    }
  }

  private assertRegular(path: string): void {
    if (
      existsSync(path) &&
      (lstatSync(path).isSymbolicLink() || !statSync(path).isFile())
    ) {
      throw new Error("Fleet persistence file must be a regular file.");
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function isStaleLock(path: string): boolean {
  try {
    const age = Date.now() - statSync(path).mtimeMs;
    return age > LOCK_STALE_MS;
  } catch {
    return true;
  }
}
