import { existsSync } from "fs";
import { join } from "path";
import { redactSecrets } from "@orbit-build/shared";
import { executeLocalPackageBinary } from "./LocalPackageBinary.js";
import type { ProjectCommandRunner } from "./ProjectCommandExecutor.js";
import { hookErrorOutput } from "./AgentTextTransforms.js";

/** Runs explicit project checks; repair and dependency installation remain ordinary agent tools. */
export async function verifyEditedFile(options: {
  cwd: string;
  file: string;
  trusted: boolean;
  execute: ProjectCommandRunner;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
  if (!options.trusted) return { ok: true };
  const { cwd, file, execute, signal } = options;
  const has = (...names: string[]) =>
    names.some((name) => existsSync(join(cwd, name)));
  const run = (name: string, bin: string, args: string[]) =>
    executeLocalPackageBinary(cwd, name, bin, args, execute);
  try {
    signal?.throwIfAborted();
    if (has("biome.json", "biome.jsonc")) {
      await run("@biomejs/biome", "biome", ["format", "--write", file]);
      signal?.throwIfAborted();
      if (/\.[cm]?[jt]sx?$/i.test(file))
        await run("@biomejs/biome", "biome", ["lint", file]);
    } else {
      if (
        has(
          ".prettierrc",
          ".prettierrc.json",
          ".prettierrc.yml",
          ".prettierrc.yaml",
          ".prettierrc.js",
          "prettier.config.js",
          "prettier.config.mjs",
          "prettier.config.cjs",
        )
      ) {
        await run("prettier", "prettier", ["--write", file]);
      }
      signal?.throwIfAborted();
      if (
        /\.[cm]?[jt]sx?$/i.test(file) &&
        has(
          ".eslintrc",
          ".eslintrc.json",
          ".eslintrc.js",
          "eslint.config.js",
          "eslint.config.mjs",
          "eslint.config.cjs",
        )
      ) {
        await run("eslint", "eslint", ["--fix", file]);
        signal?.throwIfAborted();
        await run("eslint", "eslint", ["--quiet", file]);
      }
    }
    signal?.throwIfAborted();
    return { ok: true };
  } catch (error: unknown) {
    signal?.throwIfAborted();
    return {
      ok: false,
      error: `Post-edit verification failed: ${redactSecrets(hookErrorOutput(error)).slice(0, 8_000)}. Diagnose and repair through the normal tools.`,
    };
  }
}
