import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformTypeScript } from "./transform.mjs";
import { workspaceAliases } from "./workspace.mjs";

// V8 already opened coverage for this worker at startup. Child CLIs and
// sandboxed commands must run with their normal filesystem permissions.
if (process.env.NODE_TEST_CONTEXT) delete process.env.NODE_V8_COVERAGE;

registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(workspaceAliases, specifier)) {
      return { url: pathToFileURL(workspaceAliases[specifier]).href, shortCircuit: true };
    }
    if (
      specifier.startsWith(".") && specifier.endsWith(".js")
      && context.parentURL?.startsWith("file:")
    ) {
      const url = new URL(specifier, context.parentURL);
      const path = fileURLToPath(url);
      const source = path.slice(0, -3) + ".ts";
      if (!existsSync(path) && existsSync(source))
        return { url: pathToFileURL(source).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("file:") || !new URL(url).pathname.endsWith(".ts"))
      return next(url, context);
    return {
      format: "module",
      source: transformTypeScript(fileURLToPath(url)),
      shortCircuit: true,
    };
  },
});
