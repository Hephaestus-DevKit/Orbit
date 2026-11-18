import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "./testing/support.mjs";

it("rejects syntax, core rules, and TypeScript-specific diagnostics through the lint command", () => {
  mkdirSync("rag-test-temp", {recursive:true});
  const directory = mkdtempSync(join("rag-test-temp", "lint-rules-"));
  try {
    const files = [
      ["syntax.ts", "export const value = 012;"],
      ["core.ts", "debugger;"],
      ["typed.ts", "export const key = window?.location!;"],
    ].map(([name, source]) => {
      const file = join(directory,name);
      writeFileSync(file,source);
      return relative(".",file);
    });
    const result = spawnSync(process.execPath, ["scripts/lint.mjs", ...files], {encoding:"utf8"});
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain("octal");
    expect(output).toContain("no-debugger");
    expect(output).toContain("no-non-null-asserted-optional-chain");
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
