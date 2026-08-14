import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { createRequire } from "module";
import { promisify } from "util";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  readBoundedRegularFile,
  resolveSafePath,
} from "@orbit-build/shared";
import { z } from "zod";

const execFilePromise = promisify(execFile);
const PackageManifestSchema = z.object({
  name: z.string(),
  bin: z.union([z.string(), z.record(z.string())]).optional(),
});

export async function executeLocalPackageBinary(
  cwd: string,
  packageName: string,
  binaryName: string,
  args: string[],
  environment?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const binaryPath = resolveLocalPackageBinary(cwd, packageName, binaryName);
  const isJavaScript = /\.(?:cjs|mjs|js)$/i.test(binaryPath);
  const executable = isJavaScript ? process.execPath : binaryPath;
  const executableArgs = isJavaScript ? [binaryPath, ...args] : args;
  return execFilePromise(executable, executableArgs, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    cwd,
    ...(environment ? { env: { ...environment } } : {}),
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
      const manifest = PackageManifestSchema.parse(
        JSON.parse(
          readBoundedRegularFile(manifestPath, 1024 * 1024) ??
            (() => {
              throw new Error(`Package manifest disappeared: ${manifestPath}`);
            })(),
        ),
      );
      if (manifest.name === packageName) {
        const relativeBinary = resolveManifestBinary(manifest.bin, binaryName);
        if (!relativeBinary) {
          throw new Error(
            `Package "${packageName}" does not expose binary "${binaryName}".`,
          );
        }
        const binaryPath = resolveSafePath(currentDirectory, relativeBinary);
        const stats = fs.statSync(binaryPath);
        if (!stats.isFile()) {
          throw new Error(
            `Package "${packageName}" binary "${binaryName}" is not a regular file.`,
          );
        }
        return binaryPath;
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
  return bin?.[binaryName];
}

export function isValidPackageName(packageName: string): boolean {
  if (packageName.length === 0 || packageName.length > 214) return false;
  return /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(
    packageName,
  );
}
