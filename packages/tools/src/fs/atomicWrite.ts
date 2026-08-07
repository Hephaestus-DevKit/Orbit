import { randomUUID } from "crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { readBoundedRegularFile, resolveSafePath } from "@orbit-build/shared";
import { MAX_TOOL_FILE_BYTES } from "./fileLimits.js";

/** Atomically replace a workspace file and reject concurrent content changes. */
export function atomicWriteWorkspaceFile(
  cwd: string,
  requestedPath: string,
  content: string,
  expectedCurrentContent?: string | null,
): void {
  let safePath = resolveSafePath(cwd, requestedPath);
  const parent = dirname(safePath);
  mkdirSync(parent, { recursive: true });
  safePath = resolveSafePath(cwd, requestedPath);
  assertExpectedContent(safePath, expectedCurrentContent);

  const temporaryPath = join(parent, `.orbit-write-${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    const revalidatedPath = resolveSafePath(cwd, requestedPath);
    if (revalidatedPath !== safePath) {
      throw new Error("File path changed while preparing the atomic write.");
    }
    assertExpectedContent(revalidatedPath, expectedCurrentContent);
    renameSync(temporaryPath, revalidatedPath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function assertExpectedContent(
  safePath: string,
  expected: string | null | undefined,
): void {
  if (expected === undefined) return;
  const current = readBoundedRegularFile(safePath, MAX_TOOL_FILE_BYTES);
  if (expected === null) {
    if (current !== undefined) {
      throw new Error(
        "File was created by another process before Orbit wrote it.",
      );
    }
    return;
  }
  if (current !== expected) {
    throw new Error(
      "File changed after Orbit read it; refusing to overwrite concurrent edits.",
    );
  }
}
