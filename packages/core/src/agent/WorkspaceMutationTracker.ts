import { createHash } from "crypto";
import { createReadStream } from "fs";
import { lstat, readlink } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";

const GIT_PATH_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;

export interface WorkspaceMutationSnapshot {
  fingerprint: string;
  paths: string[];
  pathFingerprints: Record<string, string>;
}

export interface WorkspaceMutationDelta {
  beforeFingerprint: string;
  afterFingerprint: string;
  paths: string[];
}

/**
 * Capture the complete Git-visible workspace state without loading a possibly
 * large binary diff into memory. Ignored build products are deliberately not
 * part of the delivery mutation contract.
 */
export async function captureWorkspaceMutationSnapshot(
  cwd: string,
): Promise<WorkspaceMutationSnapshot | undefined> {
  const insideWorkTree = await readGitOutput(cwd, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (insideWorkTree?.toString("utf8").trim() !== "true") return undefined;

  const [trackedFingerprint, statusOutput, indexOutput] = await Promise.all([
    hashCompleteTrackedDiff(cwd),
    readGitOutput(cwd, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ]),
    readGitOutput(cwd, ["ls-files", "--stage", "-z", "--", "."]),
  ]);
  if (
    trackedFingerprint === undefined ||
    statusOutput === undefined ||
    indexOutput === undefined
  ) {
    return undefined;
  }

  const parsedStatus = parsePorcelainStatus(statusOutput);
  const paths = parsedStatus.paths;
  const indexEntries = parseIndexEntries(indexOutput);
  const pathFingerprints = await hashDirtyPaths(
    cwd,
    paths,
    parsedStatus.statusByPath,
    indexEntries,
  );
  const fingerprint = createHash("sha256")
    .update(trackedFingerprint)
    .update("\0")
    .update(statusOutput)
    .update("\0")
    .update(stableFingerprintMap(pathFingerprints))
    .digest("hex");

  return { fingerprint, paths, pathFingerprints };
}

export function compareWorkspaceMutationSnapshots(
  before: WorkspaceMutationSnapshot | undefined,
  after: WorkspaceMutationSnapshot | undefined,
): WorkspaceMutationDelta | undefined {
  if (!before || !after || before.fingerprint === after.fingerprint) {
    return undefined;
  }
  return {
    beforeFingerprint: before.fingerprint,
    afterFingerprint: after.fingerprint,
    paths: Array.from(new Set([...before.paths, ...after.paths]))
      .filter(
        (filePath) =>
          before.pathFingerprints[filePath] !==
          after.pathFingerprints[filePath],
      )
      .sort(),
  };
}

function parsePorcelainStatus(output: Buffer): {
  paths: string[];
  statusByPath: Map<string, string>;
} {
  const entries = output.toString("utf8").split("\0");
  const paths = new Set<string>();
  const statusByPath = new Map<string, string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const filePath = entry.slice(3).replace(/\\/g, "/");
    paths.add(filePath);
    statusByPath.set(filePath, code);
    if (/[RC]/.test(code) && entries[index + 1]) {
      const relatedPath = entries[index + 1].replace(/\\/g, "/");
      paths.add(relatedPath);
      statusByPath.set(relatedPath, code);
      index += 1;
    }
  }
  return { paths: Array.from(paths).sort(), statusByPath };
}

function parseIndexEntries(output: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  for (const entry of output.toString("utf8").split("\0")) {
    const separator = entry.indexOf("\t");
    if (separator < 0) continue;
    const metadata = entry.slice(0, separator);
    const filePath = entry.slice(separator + 1).replace(/\\/g, "/");
    const existing = entries.get(filePath);
    entries.set(filePath, existing ? `${existing}\0${metadata}` : metadata);
  }
  return entries;
}

async function hashCompleteTrackedDiff(
  cwd: string,
): Promise<string | undefined> {
  const fromHead = await hashGitOutput(cwd, [
    "diff",
    "HEAD",
    "--binary",
    "--no-ext-diff",
    "--no-textconv",
    "--",
    ".",
  ]);
  if (fromHead !== undefined) return fromHead;

  const [unstaged, staged] = await Promise.all([
    hashGitOutput(cwd, [
      "diff",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      "--",
      ".",
    ]),
    hashGitOutput(cwd, [
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      "--",
      ".",
    ]),
  ]);
  if (unstaged === undefined || staged === undefined) return undefined;
  return createHash("sha256")
    .update(unstaged)
    .update("\0")
    .update(staged)
    .digest("hex");
}

function readGitOutput(
  cwd: string,
  args: string[],
): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let exceededLimit = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > GIT_PATH_OUTPUT_LIMIT_BYTES) {
        exceededLimit = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", () => resolve(undefined));
    child.once("close", (code) => {
      resolve(code === 0 && !exceededLimit ? Buffer.concat(chunks) : undefined);
    });
  });
}

function hashGitOutput(
  cwd: string,
  args: string[],
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const hash = createHash("sha256");
    const child = spawn("git", args, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.on("data", (chunk: Buffer) => hash.update(chunk));
    child.once("error", () => resolve(undefined));
    child.once("close", (code) =>
      resolve(code === 0 ? hash.digest("hex") : undefined),
    );
  });
}

async function hashDirtyPaths(
  cwd: string,
  paths: string[],
  statusByPath: Map<string, string>,
  indexEntries: Map<string, string>,
): Promise<Record<string, string>> {
  const pathFingerprints: Record<string, string> = {};
  for (const relativePath of paths) {
    const hash = createHash("sha256")
      .update(statusByPath.get(relativePath) ?? "")
      .update("\0")
      .update(indexEntries.get(relativePath) ?? "")
      .update("\0");
    const absolutePath = path.resolve(cwd, relativePath);
    await hashPathState(hash, absolutePath);
    pathFingerprints[relativePath] = hash.digest("hex");
  }
  return pathFingerprints;
}

async function hashPathState(
  hash: ReturnType<typeof createHash>,
  absolutePath: string,
): Promise<void> {
  try {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      hash.update("symlink\0").update(await readlink(absolutePath));
      return;
    }
    if (!stats.isFile()) {
      hash.update(`non-file:${stats.mode}`);
      return;
    }
    hash.update(`file:${stats.mode}:${stats.size}\0`);
    await new Promise<void>((resolve) => {
      const stream = createReadStream(absolutePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.once("error", (error) => {
        hash.update(
          `[unreadable:${error instanceof Error ? error.name : "unknown"}]`,
        );
        resolve();
      });
      stream.once("end", resolve);
    });
  } catch (error) {
    hash.update(`[missing:${error instanceof Error ? error.name : "unknown"}]`);
  }
}

function stableFingerprintMap(values: Record<string, string>): string {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, fingerprint]) => `${filePath}\0${fingerprint}`)
    .join("\0");
}
