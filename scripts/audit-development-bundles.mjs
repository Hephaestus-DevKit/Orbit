// The registry advisory API sees published package versions. Check the installed
// distributions too: some build and test tools inline dependencies as JavaScript.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

export function inspectInstalledTools(root) {
  const packages = parse(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")).packages;
  if (!packages || !Object.keys(packages).length) throw new Error("Missing lockfile package inventory.");
  const matches = Object.keys(packages).filter(key => key.startsWith("picomatch@"));
  const store = join(root,"node_modules",".pnpm");
  const roots = readdirSync(store,{withFileTypes:true}).filter(entry => entry.isDirectory() && entry.name !== "node_modules");
  if (!roots.length) throw new Error("Missing installed pnpm packages. Install the frozen lockfile first.");
  let files = 0;
  function inspect(directory) {
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      const path = join(directory,entry.name);
      // Other package roots are linked from here. Each physical copy is scanned once.
      if (entry.isDirectory()) { inspect(path); continue; }
      if (!entry.isFile()) continue;
      if (entry.name === "package.json") {
        if (JSON.parse(readFileSync(path,"utf8")).name === "picomatch") matches.push(relative(root,path));
        continue;
      }
      if (/\.(?:wasm|node|exe)$/i.test(entry.name) || !entry.name.includes(".")) {
        const data = readFileSync(path);
        files++;
        if (["node_modules/picomatch/","node_modules\\picomatch\\","require_picomatch"].some(marker => data.includes(marker))) matches.push(relative(root,path));
        continue;
      }
      if (!/\.(?:[cm]?js|map|LICENSE|txt)$/.test(entry.name)) continue;
      files++;
      const content = readFileSync(path,"utf8");
      if (/(?:node_modules[/\\]+picomatch[/\\]+|\brequire_picomatch\d*\b|^- picomatch@\d|%% picomatch@\d)/m.test(content)) matches.push(relative(root,path));
    }
  }
  for (const entry of roots) inspect(join(store,entry.name));
  if (!files) throw new Error("Installed package scan found no JavaScript or bundle inventories.");
  return {matches,files};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {matches,files} = inspectInstalledTools(resolve("."));
  if (matches.length) throw new Error("Installed picomatch package or bundle markers found:\n" + matches.join("\n"));
  console.log("Verified lockfile package names and " + files + " installed distribution files.");
}
