import readline from "node:readline";
import picocolors from "picocolors";
import { z } from "zod";
import {
  applySessionRetention,
  planSessionRetention,
  type SessionRetentionApplyResult,
  type SessionRetentionPlan,
} from "@orbit-build/session";

const SessionRetentionCommandOptionsSchema = z
  .object({
    olderThanDays: z.coerce.number().int().min(1).max(3_650).optional(),
    maxSessions: z.coerce.number().int().min(1).max(100_000).optional(),
    maxBytes: z.coerce
      .number()
      .int()
      .positive()
      .max(2 * 1024 * 1024 * 1024)
      .optional(),
    includeActive: z.boolean().default(false),
    yes: z.boolean().default(false),
    json: z.boolean().default(false),
  })
  .strict();

export interface SessionRetentionCommandOptions {
  olderThanDays?: number | string;
  maxSessions?: number | string;
  maxBytes?: number | string;
  includeActive?: boolean;
  yes?: boolean;
  json?: boolean;
}

export interface SessionRetentionCommandDependencies {
  confirm?: (prompt: string) => Promise<boolean>;
  write?: (text: string) => void;
  interactive?: boolean;
}

/** Preview or apply bounded session retention without touching project source. */
export async function runSessionRetention(
  cwd: string,
  rawOptions: SessionRetentionCommandOptions,
  dependencies: SessionRetentionCommandDependencies = {},
): Promise<
  SessionRetentionApplyResult | { applied: false; plan: SessionRetentionPlan }
> {
  const options = SessionRetentionCommandOptionsSchema.parse(rawOptions);
  const policy = {
    ...(options.olderThanDays !== undefined
      ? { olderThanDays: options.olderThanDays }
      : {}),
    ...(options.maxSessions !== undefined
      ? { maxSessions: options.maxSessions }
      : {}),
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    keepActive: !options.includeActive,
  };
  const plan = planSessionRetention(cwd, policy);
  const write = dependencies.write ?? ((text: string) => console.log(text));
  if (options.json && !options.yes) {
    write(JSON.stringify({ schemaVersion: 1, applied: false, plan }));
    return { applied: false, plan };
  }
  if (!options.json) printPlan(plan, write);
  if (plan.candidates.length === 0) {
    if (options.json)
      write(JSON.stringify({ schemaVersion: 1, applied: false, plan }));
    return { applied: false, plan };
  }

  let confirmed = options.yes;
  if (!confirmed) {
    const interactive =
      dependencies.interactive ?? Boolean(process.stdin.isTTY);
    if (!interactive) {
      throw new Error("Retention requires interactive confirmation or --yes.");
    }
    confirmed = await (dependencies.confirm ?? confirmRetention)(
      "Type RETAIN to remove the listed Orbit sessions: ",
    );
  }
  if (!confirmed) {
    if (!options.json) write(picocolors.yellow("⚠ Retention cancelled."));
    return { applied: false, plan };
  }

  const result = applySessionRetention(cwd, plan);
  if (options.json) {
    write(JSON.stringify(result));
  } else {
    write(
      picocolors.green(
        `✔ Retention removed ${result.deleted.length} session(s); skipped ${result.skipped.length}.`,
      ),
    );
  }
  return result;
}

function printPlan(
  plan: SessionRetentionPlan,
  write: (text: string) => void,
): void {
  write(picocolors.bold("\nOrbit session retention preview\n"));
  write(
    `  ● ${plan.totalSessions} session(s) · ${formatBytes(plan.totalBytes)} total · ${plan.protectedActiveSessions} active protected`,
  );
  if (plan.candidates.length === 0) {
    write(picocolors.gray("  No sessions match the retention policy."));
  } else {
    for (const candidate of plan.candidates) {
      write(
        `  ✖ ${candidate.id} · ${candidate.status} · ${formatBytes(candidate.bytes)} · ${candidate.reasons.join(",")}`,
      );
    }
  }
  for (const warning of plan.warnings)
    write(picocolors.yellow(`  ⚠ ${warning}`));
  write(
    picocolors.gray(
      "\nOnly Orbit-owned session directories are eligible. Active sessions stay protected unless --include-active is explicit.",
    ),
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

async function confirmRetention(prompt: string): Promise<boolean> {
  const instance = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await new Promise<string>((resolve) =>
      instance.question(prompt, resolve),
    );
    return answer.trim() === "RETAIN";
  } finally {
    instance.close();
  }
}
