import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

export function transformTypeScript(sourcefile) {
  const source = readFileSync(sourcefile, "utf8");
  return transformSync(source, {
    loader: "ts",
    format: "esm",
    target: "esnext",
    sourcefile,
    sourcemap: "inline",
  }).code;
}
