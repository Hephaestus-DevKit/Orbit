import { readFile } from "fs/promises";
import { pathToFileURL } from "url";
import { parse } from "yaml";
import { z } from "zod";

const DependencyReferenceSchema = z.union([
  z.string(),
  z.object({ version: z.string() }).passthrough(),
]);
const DependencyMapSchema = z.record(DependencyReferenceSchema);
const ImporterSchema = z
  .object({
    dependencies: DependencyMapSchema.optional(),
    optionalDependencies: DependencyMapSchema.optional(),
  })
  .passthrough();
const SnapshotSchema = z
  .object({
    dependencies: DependencyMapSchema.optional(),
    optionalDependencies: DependencyMapSchema.optional(),
  })
  .passthrough();
const LockfileSchema = z
  .object({
    importers: z.record(ImporterSchema),
    snapshots: z.record(SnapshotSchema),
  })
  .passthrough();
const AdvisorySchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    title: z.string(),
    severity: z.enum(["info", "low", "moderate", "high", "critical"]),
    url: z.string().url().optional(),
    vulnerable_versions: z.string().optional(),
  })
  .passthrough();
const BulkAdvisoryResponseSchema = z.record(z.array(AdvisorySchema));

const severityRank = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function referenceVersion(reference) {
  return typeof reference === "string" ? reference : reference.version;
}

function isExternalReference(reference) {
  return !/^(?:link:|workspace:|file:)/.test(reference);
}

function resolveSnapshotKey(name, reference, snapshots) {
  const exact = `${name}@${reference}`;
  if (snapshots[exact]) return exact;

  const normalizedReference = reference.replace(/^npm:/, "");
  const normalized = `${name}@${normalizedReference}`;
  if (snapshots[normalized]) return normalized;

  const baseVersion = normalizedReference.split("(", 1)[0];
  return Object.keys(snapshots).find(
    (key) =>
      key === `${name}@${baseVersion}` ||
      key.startsWith(`${name}@${baseVersion}(`),
  );
}

function versionFromSnapshotKey(name, snapshotKey) {
  return snapshotKey.slice(name.length + 1).split("(", 1)[0];
}

/** Builds the npm bulk-advisory payload from production workspace edges. */
export function collectProductionVersions(rawLockfile) {
  const lockfile = LockfileSchema.parse(rawLockfile);
  const queue = [];
  const visitedSnapshots = new Set();
  const versions = new Map();

  const enqueueDependencies = (dependencies = {}) => {
    for (const [name, rawReference] of Object.entries(dependencies)) {
      const reference = referenceVersion(rawReference);
      if (!isExternalReference(reference)) continue;
      queue.push({ name, reference });
    }
  };

  for (const importer of Object.values(lockfile.importers)) {
    enqueueDependencies(importer.dependencies);
    enqueueDependencies(importer.optionalDependencies);
  }

  while (queue.length > 0) {
    const dependency = queue.shift();
    const snapshotKey = resolveSnapshotKey(
      dependency.name,
      dependency.reference,
      lockfile.snapshots,
    );
    if (!snapshotKey || visitedSnapshots.has(snapshotKey)) continue;
    visitedSnapshots.add(snapshotKey);

    const version = versionFromSnapshotKey(dependency.name, snapshotKey);
    const packageVersions = versions.get(dependency.name) || new Set();
    packageVersions.add(version);
    versions.set(dependency.name, packageVersions);

    const snapshot = lockfile.snapshots[snapshotKey];
    enqueueDependencies(snapshot.dependencies);
    enqueueDependencies(snapshot.optionalDependencies);
  }

  return Object.fromEntries(
    [...versions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, packageVersions]) => [name, [...packageVersions].sort()]),
  );
}

export function failingAdvisories(response, minimumSeverity) {
  const parsed = BulkAdvisoryResponseSchema.parse(response);
  const minimumRank = severityRank[minimumSeverity];
  return Object.entries(parsed)
    .flatMap(([packageName, advisories]) =>
      advisories.map((advisory) => ({ packageName, ...advisory })),
    )
    .filter((advisory) => severityRank[advisory.severity] >= minimumRank)
    .sort(
      (left, right) =>
        severityRank[right.severity] - severityRank[left.severity] ||
        left.packageName.localeCompare(right.packageName),
    );
}

/**
 * Keep advisory-network failures fail-closed while making restricted runners
 * diagnosable without echoing arbitrary response bodies or credentials.
 */
export function formatAdvisoryRequestFailure(
  error,
  endpoint = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
  attempts = 3,
) {
  const source = error instanceof Error ? error : new Error(String(error));
  const cause = source.cause;
  const causeDetails =
    cause && typeof cause === "object"
      ? [
          typeof cause.code === "string" ? `code=${cause.code}` : "",
          typeof cause.errno === "number" || typeof cause.errno === "string"
            ? `errno=${cause.errno}`
            : "",
          typeof cause.syscall === "string" ? `syscall=${cause.syscall}` : "",
        ].filter(Boolean)
      : [];
  const details = [source.name, source.message, ...causeDetails].filter(
    (value, index, values) => value && values.indexOf(value) === index,
  );
  return `Unable to query npm advisory endpoint after ${attempts} attempt(s): ${endpoint}. ${details.join("; ")}`.slice(
    0,
    1_000,
  );
}

async function requestBulkAdvisories(payload) {
  const endpoint =
    "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Npm-Command": "audit",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `npm bulk advisory endpoint returned HTTP ${response.status}`,
        );
      }
      return BulkAdvisoryResponseSchema.parse(await response.json());
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(formatAdvisoryRequestFailure(lastError, endpoint, 3), {
    cause: lastError,
  });
}

function parseMinimumSeverity(argv) {
  const index = argv.indexOf("--level");
  const level = index >= 0 ? argv[index + 1] : "high";
  if (!(level in severityRank)) {
    throw new Error(`Invalid audit severity: ${level || "(missing)"}`);
  }
  return level;
}

async function main() {
  const minimumSeverity = parseMinimumSeverity(process.argv.slice(2));
  const lockfile = parse(await readFile("pnpm-lock.yaml", "utf8"));
  const payload = collectProductionVersions(lockfile);
  const packageCount = Object.keys(payload).length;
  if (packageCount === 0) {
    throw new Error("No production packages were found in pnpm-lock.yaml.");
  }

  const response = await requestBulkAdvisories(payload);
  const failures = failingAdvisories(response, minimumSeverity);
  if (failures.length > 0) {
    console.error(
      `✖ Found ${failures.length} production advisory(s) at ${minimumSeverity} severity or higher:`,
    );
    for (const advisory of failures) {
      console.error(
        `- [${advisory.severity}] ${advisory.packageName}: ${advisory.title}${advisory.url ? ` (${advisory.url})` : ""}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const advisoryCount = Object.values(response).reduce(
    (sum, advisories) => sum + advisories.length,
    0,
  );
  console.log(
    `✔ Production audit passed via npm bulk advisories: ${packageCount} packages checked, ${advisoryCount} advisory(s), none at ${minimumSeverity} or higher.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✖ Production audit failed: ${message}`);
    process.exitCode = 1;
  });
}
