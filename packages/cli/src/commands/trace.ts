import {
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, resolve } from "path";
import { randomUUID } from "crypto";
import { SessionStore } from "@orbit-build/session";
import { resolveSafePath } from "@orbit-build/shared";
import { z } from "zod";

const TraceOptionsSchema = z.object({
  full: z.boolean().default(false),
  out: z.string().trim().min(1).max(4096).optional(),
});

export type TraceOptions = z.input<typeof TraceOptionsSchema>;

/** Export a versioned, redacted session trace for support or replay analysis. */
export function runTraceExport(
  cwd: string,
  sessionId: string,
  options: TraceOptions = {},
): string | undefined {
  const value = TraceOptionsSchema.parse(options);
  const store = new SessionStore(cwd);
  const trace = store.exportTrace(sessionId, {
    includeHistory: value.full,
  });
  const serialized = `${JSON.stringify(trace, null, 2)}\n`;
  if (!value.out) {
    console.log(serialized.trimEnd());
    return undefined;
  }

  const outputPath = resolveSafePath(cwd, value.out);
  const directory = dirname(outputPath);
  if (existsSync(directory)) {
    const stats = lstatSync(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("Trace output directory must be a real directory.");
    }
  } else {
    mkdirSync(directory, { recursive: true });
  }
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    if (existsSync(outputPath)) rmSync(outputPath, { force: true });
    renameSync(temporaryPath, outputPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return resolve(outputPath);
}
