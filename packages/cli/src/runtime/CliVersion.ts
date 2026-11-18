import { readFileSync } from "node:fs";
import { z } from "zod";

const CliPackageManifestSchema = z.object({
  version: z
    .string()
    .trim()
    .regex(
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
      "expected a semantic version",
    ),
});

function loadCliVersion(): string {
  const candidates = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];
  let lastError: unknown;
  for (const manifestUrl of candidates) {
    try {
      const manifest = CliPackageManifestSchema.parse(
        JSON.parse(readFileSync(manifestUrl, "utf8")) as unknown,
      );
      return manifest.version;
    } catch (error: unknown) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Unable to read the Orbit CLI package version: ${detail}`, {
    cause: lastError,
  });
}

// Capture this once. npm can replace package.json during /update, but a live
// process must continue reporting the version of the code it actually loaded.
export const RUNNING_CLI_VERSION = loadCliVersion();

/** Return the immutable version of the currently running Orbit process. */
export function readCliVersion(): string {
  return RUNNING_CLI_VERSION;
}
