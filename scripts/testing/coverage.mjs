import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mergeScriptCovs } from "@bcoe/v8-coverage";
import { createCoverageMap } from "@vitest/istanbul-lib-coverage";
import { parse } from "acorn";
import { convert } from "ast-v8-to-istanbul";
import config from "./coverage-files.json" with { type: "json" };
import { transformTypeScript } from "./transform.mjs";

export async function reportCoverage(directory) {
  const scripts = new Map(config.include.map(file => [pathToFileURL(resolve(file)).href, []]));
  for (const file of readdirSync(directory)) {
    if (!file.endsWith(".json")) continue;
    const report = JSON.parse(readFileSync(join(directory, file), "utf8"));
    for (const script of report.result) scripts.get(script.url)?.push(script);
  }
  const coverage = createCoverageMap({});
  for (const [url, samples] of scripts) {
    const code = transformTypeScript(fileURLToPath(url));
    const encoded = code.match(/sourceMappingURL=data:[^\n]*?base64,([^\n]+)/)?.[1];
    if (!encoded) throw new Error("Missing TypeScript source map: " + url);
    const sourceMap = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    sourceMap.sources = [url];
    // Include unexecuted files with zero hits in every denominator.
    const result = samples.length ? mergeScriptCovs(samples) : {
      url, functions: [{functionName:"",isBlockCoverage:true,ranges:[{startOffset:0,endOffset:code.length,count:0}]}],
    };
    coverage.merge(await convert({
      ast: parse(code, {ecmaVersion:"latest",sourceType:"module",locations:true}),
      code, sourceMap, wrapperLength:0, coverage:result,
    }));
  }
  const total = coverage.getCoverageSummary().toJSON();
  const summary = { total };
  for (const file of coverage.files()) summary[file] = coverage.fileCoverageFor(file).toSummary().toJSON();
  if (coverage.files().length !== scripts.size) throw new Error("Critical file coverage inventory is incomplete.");
  mkdirSync("coverage/critical",{recursive:true});
  writeFileSync("coverage/critical/coverage-summary.json", JSON.stringify(summary,null,2));
  const failures = [];
  for (const [metric, threshold] of Object.entries(config.thresholds)) {
    const { pct, covered, total: count } = total[metric];
    console.log(metric + ": " + pct + "% (" + covered + "/" + count + "), required " + threshold + "%");
    if (!Number.isFinite(pct) || pct < threshold) failures.push(metric);
  }
  if (failures.length) throw new Error("Critical coverage below threshold: " + failures.join(", "));
}
