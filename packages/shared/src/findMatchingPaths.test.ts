import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "../../../scripts/testing/support.mjs";
import { findMatchingPaths } from "./findMatchingPaths.js";

it("matches named paths and directories and prunes ignored subtrees", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "orbit-discovery-"));
  try {
    await mkdir(join(cwd, "src", "generated"), { recursive: true });
    await writeFile(join(cwd, "src", "app.ts"), "");
    await writeFile(join(cwd, "src", "generated", "output.ts"), "");
    const options = {
      cwd,
      ignore: ["**/generated/**"],
      includeDirectories: true,
    };
    expect((await findMatchingPaths("**/*", options)).sort()).toEqual([
      "src",
      "src/app.ts",
    ]);
    expect(
      await findMatchingPaths("src/*.ts", { cwd, absolute: true }),
    ).toEqual([join(cwd, "src", "app.ts")]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
