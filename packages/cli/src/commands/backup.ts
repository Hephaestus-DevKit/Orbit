import { basename, resolve } from "path";
import picocolors from "picocolors";
import { z } from "zod";
import {
  createProjectBackup,
  readProjectBackup,
  restoreProjectBackup,
  writeProjectBackup,
} from "../runtime/ProjectBackup.js";

const BackupOptionsSchema = z
  .object({
    output: z.string().min(1).max(4096).optional(),
    json: z.boolean().prefault(false),
  })
  .strict();

/** Export durable project state without caches or credentials. */
export function runBackupCreate(
  cwd: string,
  rawOptions: { output?: string; json?: boolean } = {},
): string {
  const options = BackupOptionsSchema.parse(rawOptions);
  const bundle = createProjectBackup(cwd);
  const fallback = `orbit-${safeFilename(bundle.sourceName)}-${bundle.createdAt.slice(0, 10)}.orbit-backup.json`;
  const outputPath = writeProjectBackup(
    resolve(cwd, options.output ?? fallback),
    bundle,
  );
  if (options.json) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        outputPath,
        files: bundle.files.length,
        bytes: bundle.files.reduce((total, file) => total + file.size, 0),
      }),
    );
  } else {
    console.log(
      picocolors.green(
        `✔ Backed up ${bundle.files.length} durable project file(s) to ${outputPath}`,
      ),
    );
    console.log(
      picocolors.gray(
        "  Regenerable caches, temporary state, exports, and credentials were excluded.",
      ),
    );
  }
  return outputPath;
}

/** Inspect and validate a backup without restoring it. */
export function runBackupInspect(
  input: string,
  options: { json?: boolean } = {},
): void {
  const bundle = readProjectBackup(input);
  const summary = {
    schemaVersion: bundle.schemaVersion,
    sourceName: bundle.sourceName,
    createdAt: bundle.createdAt,
    files: bundle.files.length,
    bytes: bundle.files.reduce((total, file) => total + file.size, 0),
  };
  if (options.json) console.log(JSON.stringify(summary));
  else {
    console.log(picocolors.bold(`\n${basename(input)}\n`));
    console.log(`  Project: ${summary.sourceName}`);
    console.log(`  Created: ${summary.createdAt}`);
    console.log(
      `  Content: ${summary.files} files · ${formatBytes(summary.bytes)}`,
    );
    console.log(picocolors.green("  ✔ Integrity verified"));
  }
}

/** Restore a validated project backup into the selected workspace. */
export function runBackupRestore(
  cwd: string,
  input: string,
  options: { force?: boolean; json?: boolean } = {},
): void {
  const bundle = readProjectBackup(input);
  const result = restoreProjectBackup(cwd, bundle, { force: !!options.force });
  if (options.json) {
    console.log(JSON.stringify({ schemaVersion: 1, ...result }));
  } else {
    console.log(
      picocolors.green(
        `✔ Restored ${result.restored.length} project file(s) from ${resolve(input)}`,
      ),
    );
    if (result.conflicts.length > 0) {
      console.log(
        picocolors.yellow(
          `  Replaced ${result.conflicts.length} existing file(s) because --force was supplied.`,
        ),
      );
    }
  }
}

function safeFilename(value: string): string {
  return (
    value.replaceAll(/[^a-zA-Z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "") ||
    "project"
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
