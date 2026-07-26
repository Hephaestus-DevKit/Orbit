import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { createRequire } from "module";
import { promisify } from "util";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";

const execFilePromise = promisify(execFile);

export async function executeLocalPackageBinary(
  cwd: string,
  packageName: string,
  binaryName: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const binaryPath = resolveLocalPackageBinary(cwd, packageName, binaryName);
  const isJavaScript = /\.(?:cjs|mjs|js)$/i.test(binaryPath);
  const executable = isJavaScript ? process.execPath : binaryPath;
  const executableArgs = isJavaScript ? [binaryPath, ...args] : args;
  return execFilePromise(executable, executableArgs, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
}

export function resolveLocalPackageBinary(
  cwd: string,
  packageName: string,
  binaryName: string,
): string {
  const workspaceRequire = createRequire(path.join(cwd, "package.json"));
  const entryPath = workspaceRequire.resolve(packageName);
  let currentDirectory = path.dirname(entryPath);

  while (true) {
    const manifestPath = path.join(currentDirectory, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        name?: unknown;
        bin?: unknown;
      };
      if (manifest.name === packageName) {
        const relativeBinary = resolveManifestBinary(manifest.bin, binaryName);
        if (!relativeBinary) {
          throw new Error(
            `Package "${packageName}" does not expose binary "${binaryName}".`,
          );
        }
        return path.resolve(currentDirectory, relativeBinary);
      }
    }
    const parent = path.dirname(currentDirectory);
    if (parent === currentDirectory) break;
    currentDirectory = parent;
  }

  throw new Error(
    `Unable to locate local package binary for "${packageName}".`,
  );
}

function resolveManifestBinary(
  bin: unknown,
  binaryName: string,
): string | undefined {
  if (typeof bin === "string") return bin;
  if (typeof bin !== "object" || bin === null) return undefined;
  const candidate = (bin as Record<string, unknown>)[binaryName];
  return typeof candidate === "string" ? candidate : undefined;
}

export function isValidPackageName(packageName: string): boolean {
  if (packageName.length === 0 || packageName.length > 214) return false;
  return /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(
    packageName,
  );
}
