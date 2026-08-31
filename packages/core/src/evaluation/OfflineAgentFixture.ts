import { z } from "zod";
import { ScriptedProviderScenarioSchema } from "./ScriptedModelProvider.js";

const MAX_FIXTURE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 1_000_000;
const WINDOWS_RESERVED_SEGMENT =
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;

const PortableRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .superRefine((value, context) => {
    const normalized = value.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (
      normalized.startsWith("/") ||
      /^[A-Za-z]:\//.test(normalized) ||
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Fixture file paths must be portable, workspace-relative paths without traversal.",
      });
    }
    if (
      value !== value.trim() ||
      /[\u0000-\u001f\u007f]/.test(value) ||
      /[<>:"|?*]/.test(value) ||
      segments.some(
        (segment) =>
          Buffer.byteLength(segment, "utf8") > 255 ||
          /[ .]$/.test(segment) ||
          WINDOWS_RESERVED_SEGMENT.test(segment),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Fixture file paths must be portable across Windows, macOS, and Linux.",
      });
    }
  })
  .transform((value) => value.replaceAll("\\", "/"));

const OfflineWorkspaceFileSchema = z
  .object({
    path: PortableRelativePathSchema,
    content: z
      .string()
      .max(MAX_FILE_BYTES)
      .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_FILE_BYTES, {
        message: `Fixture file exceeds ${MAX_FILE_BYTES} UTF-8 bytes.`,
      }),
  })
  .strict();

/** Versioned, network-free acceptance case for the real AgentLoop. */
export const OfflineAgentFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    prompt: z.string().trim().min(1).max(20_000),
    workspace: z
      .object({
        files: z.array(OfflineWorkspaceFileSchema).max(64).default([]),
      })
      .strict()
      .default({}),
    providerScenario: ScriptedProviderScenarioSchema,
    expected: z
      .object({
        status: z.enum(["completed", "failed", "aborted"]),
        transcriptIncludes: z
          .array(z.string().min(1).max(20_000))
          .max(32)
          .default([]),
        maxAttempts: z.number().int().positive().max(100).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((fixture, context) => {
    fixture.providerScenario.steps.forEach((step, stepIndex) => {
      step.actions.forEach((action, actionIndex) => {
        if (action.type === "wait") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "providerScenario",
              "steps",
              stepIndex,
              "actions",
              actionIndex,
            ],
            message:
              "Catalog fixtures cannot contain unreleased wait gates; use a controller-driven provider test for races.",
          });
        }
      });
    });
    const paths = new Set<string>();
    let totalBytes = 0;
    fixture.workspace.files.forEach((file, index) => {
      const key = file.path.replaceAll("\\", "/").toLowerCase();
      if (paths.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workspace", "files", index, "path"],
          message: `Duplicate portable fixture path: ${file.path}`,
        });
      }
      paths.add(key);
      totalBytes += Buffer.byteLength(file.content, "utf8");
    });
    fixture.workspace.files.forEach((file, index) => {
      const segments = file.path.toLowerCase().split("/");
      for (let end = 1; end < segments.length; end += 1) {
        if (paths.has(segments.slice(0, end).join("/"))) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["workspace", "files", index, "path"],
            message: `Fixture path has a file as its parent directory: ${file.path}`,
          });
          break;
        }
      }
    });
    if (totalBytes > MAX_FIXTURE_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspace", "files"],
        message: `Fixture workspace exceeds ${MAX_FIXTURE_BYTES} bytes.`,
      });
    }
  });

export type OfflineAgentFixture = z.infer<typeof OfflineAgentFixtureSchema>;
