import { z } from "zod";
import {
  readResponseTextWithinLimit,
  redactSecrets,
  registerSecretForRedaction,
  unregisterSecretForRedaction,
} from "@orbit-build/shared";
import { boundGithubText, githubHeaders } from "./githubReview.js";

const MAX_INPUTS = 20;
const MAX_INPUT_VALUE_LENGTH = 1_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;

const SafeWorkflowSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      /^(?:[0-9]+|[A-Za-z0-9_.-]+\.ya?ml)$/i.test(value) &&
      !value.includes(".."),
    "Expected a workflow numeric ID or a simple .yml/.yaml filename.",
  );

const SafeRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Workflow ref cannot contain control characters.",
  });

const InputsSchema = z
  .record(
    z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/, "Invalid workflow input name."),
    z.string().max(MAX_INPUT_VALUE_LENGTH),
  )
  .default({})
  .superRefine((value, context) => {
    if (Object.keys(value).length > MAX_INPUTS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: `Workflow dispatch accepts at most ${MAX_INPUTS} inputs.`,
      });
    }
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes > MAX_REQUEST_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "string",
        maximum: MAX_REQUEST_BYTES,
        inclusive: true,
        path: [],
        message: `Workflow dispatch inputs exceed the ${MAX_REQUEST_BYTES}-byte request budget.`,
      });
    }
  });

export const GithubDispatchOptionsSchema = z
  .object({
    repo: z
      .string()
      .regex(
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
        "Expected a safe owner/repository name.",
      ),
    workflow: SafeWorkflowSchema,
    ref: SafeRefSchema.default("main"),
    inputs: InputsSchema,
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

export type GithubDispatchOptions = z.input<typeof GithubDispatchOptionsSchema>;

export interface GithubDispatchDependencies {
  fetchImplementation?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  write?: (text: string) => void;
}

export interface GithubDispatchResult {
  schemaVersion: 1;
  applied: boolean;
  endpoint: string;
  workflow: string;
  ref: string;
  inputs: Record<string, string>;
  responseStatus?: number;
}

/** Parse repeated `--input name=value` options without accepting ambiguous keys. */
export function parseGithubDispatchInputs(
  values: string[] = [],
): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const raw of values) {
    const separator = raw.indexOf("=");
    if (separator <= 0) {
      throw new Error(
        `Invalid workflow input "${boundGithubText(raw, 120)}"; expected name=value.`,
      );
    }
    const name = raw.slice(0, separator);
    const value = raw.slice(separator + 1);
    if (Object.prototype.hasOwnProperty.call(inputs, name)) {
      throw new Error(`Workflow input "${name}" was provided more than once.`);
    }
    inputs[name] = value;
  }
  return inputs;
}

/** Dry-run or explicitly trigger one GitHub Actions workflow dispatch. */
export async function runGithubDispatch(
  rawOptions: GithubDispatchOptions,
  dependencies: GithubDispatchDependencies = {},
): Promise<GithubDispatchResult> {
  const options = GithubDispatchOptionsSchema.parse(rawOptions);
  const endpoint = buildWorkflowDispatchEndpoint(
    options.apiBaseUrl,
    options.repo,
    options.workflow,
  );
  const result: GithubDispatchResult = {
    schemaVersion: 1,
    applied: false,
    endpoint,
    workflow: options.workflow,
    ref: options.ref,
    inputs: options.inputs,
  };
  const write = dependencies.write ?? ((text: string) => console.log(text));
  if (!options.apply) {
    write(
      options.json
        ? JSON.stringify(result, null, 2)
        : `Orbit GitHub workflow dry-run: ${options.workflow} @ ${options.ref} · ${endpoint}`,
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
    const response = await fetchImplementation(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...githubHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: options.ref, inputs: options.inputs }),
    });
    const responseText = await readResponseTextWithinLimit(
      response,
      MAX_RESPONSE_BYTES,
      "GitHub workflow dispatch response",
    );
    if (!response.ok) {
      throw new Error(
        `GitHub workflow dispatch failed with HTTP ${response.status}: ${redactSecrets(
          extractMessage(responseText),
        )}`,
      );
    }
    const appliedResult: GithubDispatchResult = {
      ...result,
      applied: true,
      responseStatus: response.status,
    };
    write(
      options.json
        ? JSON.stringify(appliedResult, null, 2)
        : `✔ GitHub workflow dispatched: ${options.workflow} @ ${options.ref}`,
    );
    return appliedResult;
  } catch (error: unknown) {
    if (controller.signal.aborted)
      throw new Error("GitHub workflow dispatch request timed out.");
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

export function buildWorkflowDispatchEndpoint(
  apiBaseUrl: string,
  repo: string,
  workflow: string,
): string {
  const base = new URL(apiBaseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  return `${base.origin}${prefix}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
}

function extractMessage(value: string): string {
  if (!value) return "unknown GitHub API error";
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed) && typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // GitHub proxies may return plain text; keep it bounded below.
  }
  return value.slice(0, 1_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
