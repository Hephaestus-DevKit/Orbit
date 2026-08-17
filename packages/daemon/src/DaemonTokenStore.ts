import { randomBytes, timingSafeEqual } from "crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname } from "path";
import {
  ensurePrivateDirectory,
  readBoundedRegularFile,
} from "@orbit-build/shared";

const TOKEN_BYTES = 32;
const TOKEN_MAX_BYTES = 256;

/** Persistent owner-only bearer token for one daemon installation. */
export class DaemonTokenStore {
  public constructor(private readonly tokenPath: string) {}

  public loadOrCreate(): string {
    ensurePrivateDirectory(dirname(this.tokenPath));
    try {
      return this.readExisting();
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
    }
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    let descriptor: number | undefined;
    let created = false;
    try {
      descriptor = openSync(
        this.tokenPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      created = true;
      writeFileSync(descriptor, `${token}\n`, { encoding: "utf8" });
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      if (process.platform !== "win32") chmodSync(this.tokenPath, 0o600);
      return token;
    } catch (error: unknown) {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // Preserve the creation error.
        }
      }
      // Two daemon starters may race. The winner's token is authoritative.
      if (isAlreadyExists(error)) return this.readExisting();
      if (created) rmSync(this.tokenPath, { force: true });
      throw error;
    }
  }

  /** Read an existing token without creating credentials during status checks. */
  public loadExisting(): string {
    return this.readExisting();
  }

  public matches(candidate: string | undefined, expected: string): boolean {
    if (!candidate) return false;
    const left = Buffer.from(candidate.trim());
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private readExisting(): string {
    const stats = lstatSync(this.tokenPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Daemon token path must be a regular file.");
    }
    const token = readBoundedRegularFile(
      this.tokenPath,
      TOKEN_MAX_BYTES,
    )?.trim();
    if (token && /^[a-f0-9]{64}$/i.test(token)) return token.toLowerCase();
    throw new Error("Daemon token file is invalid; remove it and retry.");
  }
}

function isMissingFile(error: unknown): boolean {
  return isFsCode(error, "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return isFsCode(error, "EEXIST");
}

function isFsCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String(error.code) === code
  );
}
