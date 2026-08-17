import { join } from "node:path";
import { z } from "zod";
import {
  readResponseJsonWithinLimit,
  redactSecrets,
  registerSecretForRedaction,
  unregisterSecretForRedaction,
} from "@orbit-build/shared";
import { loadReviewArtifacts, type ReviewArtifact } from "./review.js";
import {
  boundGithubText,
  buildPullRequestEndpoint,
  githubHeaders,
} from "./githubReview.js";

const MAX_COMMENTS = 50;
const MAX_EXISTING_COMMENT_PAGES = 10;
const COMMENTS_PER_PAGE = 100;
const MAX_RESPONSE_BYTES = 512 * 1024;

export const GithubReviewCommentsOptionsSchema = z
  .object({
    repo: z
      .string()
      .regex(
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
        "Expected a safe owner/repository name.",
      ),
    pullRequest: z.number().int().positive().max(1_000_000_000),
    sha: z.string().regex(/^[a-fA-F0-9]{7,64}$/, "Expected a Git commit SHA."),
    artifact: z
      .string()
      .regex(/^[a-zA-Z0-9._-]+\.json$/)
      .optional(),
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

export type GithubReviewCommentsOptions = z.input<
  typeof GithubReviewCommentsOptionsSchema
>;

export interface GithubReviewComment {
  marker: string;
  path: string;
  line: number;
  body: string;
}

export interface GithubReviewCommentsDependencies {
  fetchImplementation?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  write?: (text: string) => void;
}

export interface GithubReviewCommentsResult {
  schemaVersion: 1;
  applied: boolean;
  endpoint: string;
  planned: GithubReviewComment[];
  created: string[];
  skippedExisting: string[];
  skippedInvalid: Array<{ artifact: string; finding: string; reason: string }>;
  failures: Array<{ marker: string; error: string }>;
}

/** Build idempotent, line-addressed comments from open findings only. */
export function buildGithubReviewComments(
  artifacts: Array<{ name: string; value: ReviewArtifact }>,
): {
  comments: GithubReviewComment[];
  skippedInvalid: GithubReviewCommentsResult["skippedInvalid"];
} {
  const comments: GithubReviewComment[] = [];
  const skippedInvalid: GithubReviewCommentsResult["skippedInvalid"] = [];
  for (const artifact of artifacts) {
    for (const finding of artifact.value.findings) {
      if (finding.disposition !== "open") continue;
      if (
        finding.line === undefined ||
        !Number.isSafeInteger(finding.line) ||
        finding.line <= 0 ||
        finding.line > 1_000_000_000
      ) {
        skippedInvalid.push({
          artifact: artifact.name,
          finding: finding.id,
          reason: "finding has no valid line for an inline comment",
        });
        continue;
      }
      const originalPath = finding.file.trim().replace(/\\/g, "/");
      const path = normalizeInlineRepositoryPath(originalPath);
      if (!path) {
        skippedInvalid.push({
          artifact: artifact.name,
          finding: finding.id,
          reason:
            "finding path must be a safe repository-relative path without traversal",
        });
        continue;
      }
      const marker = `<!-- orbit-finding:${artifact.name}:${finding.id} -->`;
      comments.push({
        marker,
        path,
        line: finding.line,
        body: boundGithubText(
          `${marker}\n### ${finding.severity} · ${finding.title}\n\nEvidence: ${finding.evidence}\n\nImpact: ${finding.impact}\n\nRemediation: ${finding.remediation}`,
          8_000,
        ),
      });
      if (comments.length >= MAX_COMMENTS) return { comments, skippedInvalid };
    }
  }
  return { comments, skippedInvalid };
}

/** Dry-run or explicitly publish idempotent GitHub inline review comments. */
export async function runGithubReviewComments(
  cwd: string,
  rawOptions: GithubReviewCommentsOptions,
  dependencies: GithubReviewCommentsDependencies = {},
): Promise<GithubReviewCommentsResult> {
  const options = GithubReviewCommentsOptionsSchema.parse(rawOptions);
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
  const built = buildGithubReviewComments(artifacts);
  const endpoint =
    buildPullRequestEndpoint(
      options.apiBaseUrl,
      options.repo,
      options.pullRequest,
    ).replace(/\/+$/, "") + "/comments";
  const result: GithubReviewCommentsResult = {
    schemaVersion: 1,
    applied: false,
    endpoint,
    planned: built.comments,
    created: [],
    skippedExisting: [],
    skippedInvalid: built.skippedInvalid,
    failures: [],
  };
  const write = dependencies.write ?? ((text: string) => console.log(text));
  if (!options.apply || built.comments.length === 0) {
    write(
      options.json
        ? JSON.stringify(result, null, 2)
        : `Orbit GitHub inline-comment dry-run: ${built.comments.length} comment(s) · ${endpoint}`,
    );
    return result;
  }

  const token =
    dependencies.env?.[options.tokenEnv] ?? process.env[options.tokenEnv];
  if (!token) throw new Error(`Missing GitHub token in ${options.tokenEnv}.`);
  registerSecretForRedaction(token);
  const fetchImplementation =
    dependencies.fetchImplementation ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const existingMarkers = await loadExistingOrbitMarkers(
      fetchImplementation,
      endpoint,
      token,
      controller.signal,
    );
    const createdResult: GithubReviewCommentsResult = {
      ...result,
      applied: true,
    };
    for (const comment of built.comments) {
      if (existingMarkers.has(comment.marker)) {
        createdResult.skippedExisting.push(comment.marker);
        continue;
      }
      const response = await fetchImplementation(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          ...githubHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: comment.body,
          commit_id: options.sha,
          path: comment.path,
          line: comment.line,
          side: "RIGHT",
        }),
      });
      const body = await readResponseJsonWithinLimit(
        response,
        MAX_RESPONSE_BYTES,
        "GitHub review comment response",
      );
      if (!response.ok) {
        createdResult.failures.push({
          marker: comment.marker,
          error: `HTTP ${response.status}: ${redactSecrets(extractMessage(body))}`,
        });
        if ([401, 403, 429].includes(response.status)) break;
        continue;
      }
      createdResult.created.push(comment.marker);
    }
    write(
      options.json
        ? JSON.stringify(createdResult, null, 2)
        : `✔ GitHub inline comments: ${createdResult.created.length} created, ${createdResult.skippedExisting.length} already present, ${createdResult.failures.length} failed.`,
    );
    return createdResult;
  } catch (error: unknown) {
    if (controller.signal.aborted)
      throw new Error("GitHub inline-comment request timed out.");
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

function extractOrbitMarkers(value: unknown): Set<string> {
  const markers = new Set<string>();
  if (!Array.isArray(value)) return markers;
  for (const item of value) {
    if (!isRecord(item) || typeof item.body !== "string") continue;
    const match = /<!-- orbit-finding:[^>]+ -->/.exec(item.body);
    if (match) markers.add(match[0]);
  }
  return markers;
}

async function loadExistingOrbitMarkers(
  fetchImplementation: typeof globalThis.fetch,
  endpoint: string,
  token: string,
  signal: AbortSignal,
): Promise<Set<string>> {
  const markers = new Set<string>();
  for (let page = 1; page <= MAX_EXISTING_COMMENT_PAGES; page += 1) {
    const response = await fetchImplementation(
      `${endpoint}?per_page=${COMMENTS_PER_PAGE}&page=${page}`,
      {
        method: "GET",
        signal,
        headers: githubHeaders(token),
      },
    );
    const body = await readResponseJsonWithinLimit(
      response,
      MAX_RESPONSE_BYTES,
      "GitHub review comments response",
    );
    if (!response.ok) {
      throw new Error(
        `GitHub review comments lookup failed with HTTP ${response.status}: ${redactSecrets(extractMessage(body))}`,
      );
    }
    if (!Array.isArray(body)) {
      throw new Error(
        "GitHub review comments lookup returned an invalid list.",
      );
    }
    for (const marker of extractOrbitMarkers(body)) markers.add(marker);
    if (body.length < COMMENTS_PER_PAGE) return markers;
  }
  throw new Error(
    `GitHub review comments lookup exceeded the ${MAX_EXISTING_COMMENT_PAGES * COMMENTS_PER_PAGE}-comment safety limit; refusing to publish to avoid duplicate comments.`,
  );
}

function normalizeInlineRepositoryPath(file: string): string | undefined {
  if (
    !file ||
    file.includes("\0") ||
    /[\u0000-\u001f\u007f]/.test(file) ||
    /^[A-Za-z]:\//.test(file) ||
    file.startsWith("/") ||
    file.startsWith("//")
  ) {
    return undefined;
  }
  const segments: string[] = [];
  for (const segment of file.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      return undefined;
    }
    segments.push(segment);
  }
  if (segments.length === 0) return undefined;
  const normalized = segments.join("/");
  if (normalized.startsWith("..") || normalized.length > 1_000)
    return undefined;
  return normalized;
}

function extractMessage(value: unknown): string {
  return isRecord(value) && typeof value.message === "string"
    ? value.message
    : "unknown GitHub API error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
