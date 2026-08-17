import { join } from "node:path";
import { z } from "zod";
import {
  readResponseJsonWithinLimit,
  redactSecrets,
  registerSecretForRedaction,
  unregisterSecretForRedaction,
} from "@orbit-build/shared";
import { loadReviewArtifacts, type ReviewArtifact } from "./review.js";

const MAX_ANNOTATIONS = 50;
const MAX_RESPONSE_BYTES = 512 * 1024;

export const GithubReviewOptionsSchema = z
  .object({
    repo: z
      .string()
      .regex(
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
        "Expected a safe owner/repository name.",
      ),
    sha: z.string().regex(/^[a-fA-F0-9]{7,64}$/, "Expected a Git commit SHA."),
    artifact: z
      .string()
      .regex(/^[a-zA-Z0-9._-]+\.json$/)
      .optional(),
    pullRequest: z.number().int().positive().max(1_000_000_000).optional(),
    name: z.string().trim().min(1).max(100).default("Orbit Review"),
    tokenEnv: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]{0,127}$/)
      .default("GITHUB_TOKEN"),
    apiBaseUrl: z.string().url().default("https://api.github.com"),
    allowCustomApi: z.boolean().default(false),
    apply: z.boolean().default(false),
    json: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      const url = new URL(value.apiBaseUrl);
      if (url.protocol !== "https:") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["apiBaseUrl"],
          message: "GitHub API base URL must use HTTPS.",
        });
      }
      if (url.username || url.password) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["apiBaseUrl"],
          message: "GitHub API base URL cannot contain credentials.",
        });
      }
      if (url.hostname !== "api.github.com" && !value.allowCustomApi) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["apiBaseUrl"],
          message: "Custom GitHub API hosts require allowCustomApi.",
        });
      }
    } catch {
      // The URL schema already reports malformed URLs.
    }
  });

export type GithubReviewOptions = z.input<typeof GithubReviewOptionsSchema>;

export interface GithubReviewDependencies {
  fetchImplementation?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  write?: (text: string) => void;
}

export interface GithubCheckRunResult {
  schemaVersion: 1;
  applied: boolean;
  endpoint: string;
  conclusion: "success" | "failure";
  annotationCount: number;
  blockingFindingCount: number;
  pullRequest?: number;
  response?: { id?: number; htmlUrl?: string };
  payload?: GithubCheckRunPayload;
}

export interface GithubCheckRunPayload {
  name: string;
  head_sha: string;
  status: "completed";
  conclusion: "success" | "failure";
  output: {
    title: string;
    summary: string;
    text: string;
    annotations: Array<{
      path: string;
      start_line: number;
      end_line: number;
      annotation_level: "failure" | "warning" | "notice";
      message: string;
      title: string;
    }>;
  };
}

/** Build a bounded GitHub Checks payload from persisted Orbit findings. */
export function buildGithubCheckRunPayload(
  artifacts: ReviewArtifact[],
  options: { name: string; sha: string; pullRequest?: number },
): GithubCheckRunPayload {
  const findings = artifacts.flatMap((artifact) => artifact.findings);
  const blocking = findings.filter(
    (finding) =>
      (finding.severity === "P0" || finding.severity === "P1") &&
      finding.disposition === "open",
  );
  const annotations = findings.slice(0, MAX_ANNOTATIONS).map((finding) => ({
    path: normalizeRepositoryPath(finding.file),
    start_line: finding.line ?? 1,
    end_line: finding.line ?? 1,
    annotation_level: githubAnnotationLevel(
      finding.severity,
      finding.disposition,
    ),
    message: boundGithubText(
      `${finding.title}\nEvidence: ${finding.evidence}\nImpact: ${finding.impact}\nRemediation: ${finding.remediation}`,
      8_000,
    ),
    title: boundGithubText(`${finding.severity} · ${finding.title}`, 255),
  }));
  const summary = `${findings.length} finding(s), ${blocking.length} open P0/P1 blocking finding(s).${options.pullRequest ? ` PR #${options.pullRequest}.` : ""}`;
  const text = boundGithubText(
    artifacts
      .map(
        (artifact) =>
          `${artifact.perspective}: ${artifact.verdict}\n${artifact.feedback}`,
      )
      .join("\n\n"),
    16_000,
  );
  return {
    name: options.name,
    head_sha: options.sha,
    status: "completed",
    conclusion: blocking.length > 0 ? "failure" : "success",
    output: {
      title: "Orbit Review",
      summary,
      text,
      annotations,
    },
  };
}

/**
 * Dry-run or explicitly apply one GitHub Check Run. No token is read during a
 * dry-run, and the returned/output payload never contains the token.
 */
export async function runGithubReview(
  cwd: string,
  rawOptions: GithubReviewOptions,
  dependencies: GithubReviewDependencies = {},
): Promise<GithubCheckRunResult> {
  const options = GithubReviewOptionsSchema.parse(rawOptions);
  const artifacts = loadReviewArtifacts(join(cwd, ".orbit", "reviews")).filter(
    (item) => !options.artifact || item.name === options.artifact,
  );
  if (artifacts.length === 0) {
    throw new Error(
      options.artifact
        ? `Review artifact not found: ${options.artifact}`
        : "No persisted review artifacts found.",
    );
  }
  const payload = buildGithubCheckRunPayload(
    artifacts.map((item) => item.value),
    {
      name: options.name,
      sha: options.sha,
      pullRequest: options.pullRequest,
    },
  );
  const endpoint = buildCheckRunsEndpoint(options.apiBaseUrl, options.repo);
  const blockingFindingCount = artifacts
    .flatMap((artifact) => artifact.value.findings)
    .filter(
      (finding) =>
        (finding.severity === "P0" || finding.severity === "P1") &&
        finding.disposition === "open",
    ).length;
  const baseResult: GithubCheckRunResult = {
    schemaVersion: 1,
    applied: false,
    endpoint,
    conclusion: payload.conclusion,
    annotationCount: payload.output.annotations.length,
    blockingFindingCount,
    ...(options.pullRequest ? { pullRequest: options.pullRequest } : {}),
  };
  const write = dependencies.write ?? ((text: string) => console.log(text));
  if (!options.apply) {
    const result = { ...baseResult, payload };
    write(
      options.json
        ? JSON.stringify(result, null, 2)
        : `Orbit GitHub Check dry-run: ${payload.conclusion} · ${payload.output.annotations.length} annotation(s) · ${endpoint}`,
    );
    return result;
  }

  const token =
    dependencies.env?.[options.tokenEnv] ?? process.env[options.tokenEnv];
  if (!token) throw new Error(`Missing GitHub token in ${options.tokenEnv}.`);
  registerSecretForRedaction(token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    if (options.pullRequest !== undefined) {
      const pullRequestResponse = await (
        dependencies.fetchImplementation ?? globalThis.fetch
      )(
        buildPullRequestEndpoint(
          options.apiBaseUrl,
          options.repo,
          options.pullRequest,
        ),
        {
          method: "GET",
          signal: controller.signal,
          headers: githubHeaders(token),
        },
      );
      const pullRequestBody = await readResponseJsonWithinLimit(
        pullRequestResponse,
        MAX_RESPONSE_BYTES,
        "GitHub pull request response",
      );
      if (!pullRequestResponse.ok) {
        throw new Error(
          `GitHub pull request lookup failed with HTTP ${pullRequestResponse.status}: ${redactSecrets(extractGithubMessage(pullRequestBody))}`,
        );
      }
      const headSha = extractPullRequestHeadSha(pullRequestBody);
      if (headSha.toLowerCase() !== options.sha.toLowerCase()) {
        throw new Error(
          `GitHub pull request head SHA ${headSha} does not match requested ${options.sha}.`,
        );
      }
    }
    const response = await (
      dependencies.fetchImplementation ?? globalThis.fetch
    )(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...githubHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await readResponseJsonWithinLimit(
      response,
      MAX_RESPONSE_BYTES,
      "GitHub Check response",
    );
    if (!response.ok) {
      throw new Error(
        `GitHub Check API failed with HTTP ${response.status}: ${redactSecrets(
          extractGithubMessage(body),
        )}`,
      );
    }
    const responseRecord = isRecord(body) ? body : {};
    const result: GithubCheckRunResult = {
      ...baseResult,
      applied: true,
      response: {
        ...(typeof responseRecord.id === "number"
          ? { id: responseRecord.id }
          : {}),
        ...(typeof responseRecord.html_url === "string"
          ? { htmlUrl: responseRecord.html_url.slice(0, 2_000) }
          : {}),
      },
    };
    write(
      options.json
        ? JSON.stringify(result, null, 2)
        : `✔ GitHub Check created: ${endpoint}`,
    );
    return result;
  } catch (error: unknown) {
    if (controller.signal.aborted)
      throw new Error("GitHub Check request timed out.");
    throw new Error(
      redactSecrets(
        error instanceof Error ? error.message : String(error),
      ).slice(0, 2_000),
    );
  } finally {
    clearTimeout(timer);
    unregisterSecretForRedaction(token);
  }
}

export function buildCheckRunsEndpoint(
  apiBaseUrl: string,
  repo: string,
): string {
  const base = new URL(apiBaseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  return `${base.origin}${prefix}/repos/${repo}/check-runs`;
}

export function buildPullRequestEndpoint(
  apiBaseUrl: string,
  repo: string,
  pullRequest: number,
): string {
  const base = new URL(apiBaseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  return `${base.origin}${prefix}/repos/${repo}/pulls/${pullRequest}`;
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Orbit-Review",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function extractPullRequestHeadSha(value: unknown): string {
  if (
    isRecord(value) &&
    isRecord(value.head) &&
    typeof value.head.sha === "string" &&
    /^[a-fA-F0-9]{7,64}$/.test(value.head.sha)
  ) {
    return value.head.sha;
  }
  throw new Error(
    "GitHub pull request response did not contain a valid head SHA.",
  );
}

function githubAnnotationLevel(
  severity: ReviewArtifact["findings"][number]["severity"],
  disposition: ReviewArtifact["findings"][number]["disposition"],
): "failure" | "warning" | "notice" {
  if (disposition !== "open") return "notice";
  return severity === "P0" || severity === "P1"
    ? "failure"
    : severity === "P2"
      ? "warning"
      : "notice";
}

export function normalizeRepositoryPath(file: string): string {
  const normalized = file.trim().replace(/\\/g, "/");
  if (!normalized) return "<unknown>";
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
    return (
      normalized.split("/").filter(Boolean).at(-1) || "<outside-workspace>"
    );
  }
  return normalized.replace(/^\.\//, "").slice(0, 1_000) || "<unknown>";
}

export function boundGithubText(value: string, maxBytes: number): string {
  const redacted = redactSecrets(value);
  if (Buffer.byteLength(redacted, "utf8") <= maxBytes) return redacted;
  const suffix = "\n… [truncated]";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let result = Buffer.from(redacted, "utf8")
    .subarray(0, budget)
    .toString("utf8");
  while (Buffer.byteLength(result, "utf8") > budget) {
    result = result.slice(0, -1);
  }
  return `${result}${suffix}`;
}

function extractGithubMessage(value: unknown): string {
  return isRecord(value) && typeof value.message === "string"
    ? value.message
    : "unknown GitHub API error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
