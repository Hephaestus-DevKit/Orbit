import {it,expect} from "./testing/support.mjs";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {inspectInstalledTools} from "./audit-development-bundles.mjs";

it("detects an embedded module even when both lockfile and package metadata are clean", () => {
  const root = mkdtempSync(join(tmpdir(),"orbit-bundle-test-"));
  try {
    const dist = join(root,"node_modules",".pnpm","driver@1","node_modules","driver");
    mkdirSync(dist,{recursive:true});
    writeFileSync(join(root,"pnpm-lock.yaml"),"packages:\n  driver@1: {}\n");
    writeFileSync(join(dist,"package.json"),'{"name":"driver"}');
    writeFileSync(join(dist,"driver.js"),'// node_modules/picomatch/lib/parse.js');
    expect(inspectInstalledTools(root).matches).toHaveLength(1);
    writeFileSync(join(dist,"driver.js"),'// node_modules/other/index.js');
    expect(inspectInstalledTools(root).matches).toEqual([]);
    writeFileSync(join(root,"pnpm-lock.yaml"),"packages:\n  picomatch@4.0.7: {}\n");
    expect(inspectInstalledTools(root).matches).toEqual(["picomatch@4.0.7"]);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
