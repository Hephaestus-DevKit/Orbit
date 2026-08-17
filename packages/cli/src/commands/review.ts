import { existsSync, lstatSync, readdirSync } from "fs";
import { isAbsolute, join, relative, sep } from "path";
import { z } from "zod";
import picocolors from "picocolors";
import {
  readBoundedRegularFile,
  redactSecrets,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";

export const FindingSchema = z.object({
  id: z.string().min(1).max(120),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  title: z.string().max(500),
  file: z.string().max(1_000),
  line: z.number().int().positive().optional(),
  evidence: z.string().max(8_000),
  impact: z.string().max(8_000),
  remediation: z.string().max(8_000),
  disposition: z.enum(["open", "accepted", "fixed", "wont_fix"]),
  dispositionHistory: z
    .array(
      z.object({
        from: z.enum(["open", "accepted", "fixed", "wont_fix"]),
        to: z.enum(["open", "accepted", "fixed", "wont_fix"]),
        at: z.string().datetime(),
        actor: z.string().min(1).max(120),
        note: z.string().max(2_000).optional(),
      }),
    )
    .max(32)
    .default([]),
});
export const ReviewArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  perspective: z.string().min(1).max(200),
  reviewedAt: z.string().datetime(),
  verdict: z.enum(["approved", "rejected"]),
  feedback: z.string().max(8_000),
  findings: z.array(FindingSchema).max(100),
});
export type ReviewArtifact = z.infer<typeof ReviewArtifactSchema>;
type ReviewAction = "list" | "show" | "set" | "verify" | "export";
type ReviewExportFormat = "json" | "sarif";
const SARIF_VERSION = [2, 1, 0].join(".");

export interface ReviewCommandOptions {
  cwd?: string;
  json?: boolean;
  disposition?: ReviewArtifact["findings"][number]["disposition"];
  note?: string;
  format?: ReviewExportFormat;
  out?: string;
}

/** Inspect persisted reviewer findings and change only their disposition. */
export function runReviewCommand(
  action: ReviewAction,
  artifactName?: string,
  findingId?: string,
  options: ReviewCommandOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const root = join(cwd, ".orbit", "reviews");
  try {
    const artifacts = loadReviewArtifacts(root);
    if (action === "list") {
      emit(artifacts, options.json === true);
      return 0;
    }
    if (action === "verify") {
      const selected = artifactName
        ? artifacts.filter((item) => item.name === validateName(artifactName))
        : artifacts;
      const blockedFindings = selected.flatMap(({ name, value }) =>
        value.findings
          .filter(
            (finding) =>
              (finding.severity === "P0" || finding.severity === "P1") &&
              finding.disposition === "open",
          )
          .map((finding) => ({
            artifact: name,
            id: finding.id,
            severity: finding.severity,
            file: finding.file,
            line: finding.line,
            title: finding.title,
          })),
      );
      const result = {
        ok: blockedFindings.length === 0,
        artifacts: selected.map((item) => item.name),
        blockedFindings,
      };
      emitVerification(result, options.json === true);
      return result.ok ? 0 : 1;
    }
    if (action === "export") {
      const selected = artifactName
        ? artifacts.filter((item) => item.name === validateName(artifactName))
        : artifacts;
      if (selected.length === 0) {
        return fail(
          artifactName
            ? `Review artifact not found: ${validateName(artifactName)}`
            : "No persisted review findings.",
          options,
        );
      }
      const format = options.format ?? "json";
      const payload =
        format === "sarif"
          ? buildSarifReport(selected, cwd)
          : { schemaVersion: 1, reviews: selected };
      const serialized = `${JSON.stringify(payload, null, 2)}\n`;
      if (options.out) {
        const outputPath = resolveSafePath(cwd, options.out);
        replacePrivateFileAtomically(outputPath, serialized);
        emitExportReceipt(
          {
            format,
            artifactCount: selected.length,
            out: relative(cwd, outputPath).split(sep).join("/"),
          },
          options.json === true,
        );
      } else {
        console.log(serialized.trimEnd());
      }
      return 0;
    }
    const safeName = validateName(artifactName);
    const artifact = artifacts.find((item) => item.name === safeName)?.value;
    if (!artifact)
      return fail(`Review artifact not found: ${safeName}`, options);
    if (action === "show") {
      emit(options.json ? artifact : [artifact], options.json === true);
      return 0;
    }
    const nextDisposition = options.disposition;
    if (!findingId || !nextDisposition) {
      return fail(
        "review set requires <artifact> <finding> --disposition <value>.",
        options,
      );
    }
    const parsedDisposition =
      FindingSchema.shape.disposition.safeParse(nextDisposition);
    if (!parsedDisposition.success) {
      return fail(
        "--disposition must be open, accepted, fixed, or wont_fix.",
        options,
      );
    }
    const finding = artifact.findings.find((item) => item.id === findingId);
    if (!finding) return fail(`Finding not found: ${findingId}`, options);
    const previousDisposition = finding.disposition;
    finding.disposition = parsedDisposition.data;
    finding.dispositionHistory.push({
      from: previousDisposition,
      to: parsedDisposition.data,
      at: new Date().toISOString(),
      actor: "orbit-review-cli",
      ...(options.note ? { note: options.note.slice(0, 2_000) } : {}),
    });
    replacePrivateFileAtomically(
      join(root, safeName),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    emit(
      {
        artifact: safeName,
        findingId,
        disposition: parsedDisposition.data,
        previousDisposition,
      },
      options.json === true,
    );
    return 0;
  } catch (error: unknown) {
    return fail(
      error instanceof Error ? error.message : String(error),
      options,
    );
  }
}

/** Convert Orbit findings into SARIF 2.1.0 without exposing the workspace path. */
function buildSarifReport(
  artifacts: Array<{ name: string; value: ReviewArtifact }>,
  cwd: string,
): Record<string, unknown> {
  const rules = new Map<string, Record<string, unknown>>();
  const results: Array<Record<string, unknown>> = [];
  for (const artifact of artifacts) {
    for (const finding of artifact.value.findings) {
      if (!rules.has(finding.id)) {
        rules.set(finding.id, {
          id: finding.id,
          name: finding.title,
          shortDescription: { text: finding.title },
          properties: {
            orbitSeverity: finding.severity,
            orbitDisposition: finding.disposition,
          },
        });
      }
      const result: Record<string, unknown> = {
        ruleId: finding.id,
        level: sarifLevel(finding.severity),
        kind: "review",
        message: {
          text: `${finding.title}\nEvidence: ${finding.evidence}\nImpact: ${finding.impact}\nRemediation: ${finding.remediation}`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: normalizeReviewPath(finding.file, cwd) },
              ...(finding.line ? { region: { startLine: finding.line } } : {}),
            },
          },
        ],
        partialFingerprints: { orbitFinding: `${artifact.name}:${finding.id}` },
        properties: {
          orbitArtifact: artifact.name,
          orbitSeverity: finding.severity,
          orbitDisposition: finding.disposition,
        },
      };
      if (finding.disposition === "fixed") {
        result.baselineState = "absent";
      } else if (
        finding.disposition === "accepted" ||
        finding.disposition === "wont_fix"
      ) {
        result.suppressions = [
          {
            kind: "inSource",
            justification: `Orbit disposition: ${finding.disposition}`,
          },
        ];
      }
      results.push(result);
    }
  }
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: "Orbit Review",
            informationUri: "https://github.com/Hephaestus-DevKit/Orbit",
            rules: [...rules.values()],
          },
        },
        results,
      },
    ],
  };
}

function sarifLevel(
  severity: ReviewArtifact["findings"][number]["severity"],
): "error" | "warning" | "note" {
  return severity === "P0" || severity === "P1"
    ? "error"
    : severity === "P2"
      ? "warning"
      : "note";
}

function emitExportReceipt(
  result: { format: ReviewExportFormat; artifactCount: number; out: string },
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, ...result }, null, 2));
  } else {
    console.log(
      picocolors.green(
        `✔ Exported ${result.artifactCount} review artifact(s) as ${result.format}: ${result.out}`,
      ),
    );
  }
}

function normalizeReviewPath(file: string, cwd: string): string {
  const candidate = file.trim();
  if (!candidate) return "<unknown>";
  const absolute = isAbsolute(candidate)
    ? candidate
    : resolveSafePath(cwd, candidate);
  const relativePath = relative(cwd, absolute);
  if (
    relativePath &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  ) {
    return relativePath.split(sep).join("/");
  }
  return "<outside-workspace>";
}

export function loadReviewArtifacts(
  root: string,
): Array<{ name: string; value: ReviewArtifact }> {
  if (!existsSync(root) || !lstatSync(root).isDirectory()) return [];
  return readdirSync(root)
    .filter((name) => /^[a-zA-Z0-9._-]+\.json$/.test(name))
    .flatMap((name) => {
      const path = join(root, name);
      try {
        if (lstatSync(path).isSymbolicLink()) return [];
        const text = readBoundedRegularFile(path, 512 * 1024);
        if (!text) return [];
        const parsed = ReviewArtifactSchema.safeParse(JSON.parse(text));
        return parsed.success ? [{ name, value: parsed.data }] : [];
      } catch {
        return [];
      }
    });
}

function validateName(value: string | undefined): string {
  if (!value || !/^[a-zA-Z0-9._-]+\.json$/.test(value)) {
    throw new Error("Review artifact must be a simple .json filename.");
  }
  return value;
}

function emit(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, reviews: value }, null, 2));
    return;
  }
  if (!Array.isArray(value)) {
    console.log(picocolors.bold(`\n${value.perspective} · ${value.verdict}\n`));
    console.log(redactSecrets(value.feedback));
    for (const finding of value.findings) {
      console.log(
        `  ${finding.severity} [${finding.disposition}] ${finding.file}${finding.line ? `:${finding.line}` : ""} · ${finding.title}`,
      );
    }
    return;
  }
  if (value.length === 0) return console.log("No persisted review findings.");
  for (const item of value) {
    console.log(
      `${picocolors.cyan(item.name)} · ${item.value.verdict} · ${item.value.findings.length} finding(s)`,
    );
  }
}

function emitVerification(
  result: {
    ok: boolean;
    artifacts: string[];
    blockedFindings: Array<{
      artifact: string;
      id: string;
      severity: "P0" | "P1";
      file: string;
      line?: number;
      title: string;
    }>;
  },
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, ...result }, null, 2));
    return;
  }
  if (result.ok) {
    console.log(
      picocolors.green(
        `✔ Review gate passed (${result.artifacts.length} artifact(s)).`,
      ),
    );
    return;
  }
  console.error(
    picocolors.red(
      `✖ Review gate blocked by ${result.blockedFindings.length} open P0/P1 finding(s).`,
    ),
  );
  for (const finding of result.blockedFindings) {
    console.error(
      `  ${finding.severity} ${finding.artifact}:${finding.id} ${finding.file}${finding.line ? `:${finding.line}` : ""} · ${finding.title}`,
    );
  }
}

function fail(message: string, options: ReviewCommandOptions): number {
  if (options.json)
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        ok: false,
        error: redactSecrets(message),
      }),
    );
  else console.error(picocolors.red(`✖ ${redactSecrets(message)}`));
  return 1;
}
