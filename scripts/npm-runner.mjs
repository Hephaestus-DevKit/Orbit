import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/** Run npm's JavaScript entry point directly, including on Windows with spaces in paths. */
export function resolveNpmInvocation(args, options = {}) {
  const executable = options.execPath ?? process.execPath;
  const searchPath = options.path ?? process.env.PATH ?? "";
  const exists = options.exists ?? existsSync;
  const canonical = options.realpath ?? realpathSync;
  const directories = [dirname(executable), ...searchPath.split(delimiter)];
  for (const directory of directories) {
    if (!directory) continue;
    for (const candidate of [
      join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
      join(directory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ]) {
      if (exists(candidate))
        return { command: executable, args: [canonical(candidate), ...args] };
    }
  }
  throw new Error(
    "Cannot locate npm-cli.js beside Node.js or on PATH. Install npm with Node.js.",
  );
}
