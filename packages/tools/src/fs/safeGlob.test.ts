import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { findWorkspaceFiles, toRootRelativePath } from "./safeGlob.js";

describe("workspace glob discovery", () => {
  it("preserves alternatives, hidden files, ignore rules and traversal depth", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-safe-glob-"));
    try {
      for (const name of ["src/deep", "node_modules/pkg", "dist"])
        await mkdir(join(root, name), { recursive: true });
      for (const name of [
        "root.ts",
        ".hidden.ts",
        "src/main.ts",
        "src/view.js",
        "src/deep/nested.ts",
        "node_modules/pkg/ignored.ts",
        "dist/ignored.ts",
      ])
        await writeFile(join(root, name), "fixture");
      const discover = async (deep?: number, dot = false) =>
        (await findWorkspaceFiles(root, "**/*.{ts,js}", { deep, dot }))
          .map((file) => toRootRelativePath(root, file))
          .sort();
      expect(await discover(1)).toEqual(["root.ts"]);
      expect(await discover(2)).toEqual([
        "root.ts",
        "src/main.ts",
        "src/view.js",
      ]);
      expect(await discover(undefined, true)).toEqual([
        ".hidden.ts",
        "root.ts",
        "src/deep/nested.ts",
        "src/main.ts",
        "src/view.js",
      ]);
      expect(await findWorkspaceFiles(root, "src")).toEqual([]);
      await expect(findWorkspaceFiles(root, "../**/*")).rejects.toThrow(
        "inside",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not discover outside files through directory or file symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "orbit-safe-glob-"));
    const outside = await mkdtemp(join(tmpdir(), "orbit-safe-glob-outside-"));
    try {
      await writeFile(join(root, "inside.ts"), "inside");
      await writeFile(join(outside, "private.ts"), "outside");
      await symlink(
        outside,
        join(root, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await symlink(
        join(outside, "private.ts"),
        join(root, "private.ts"),
        "file",
      );
      expect(
        (await findWorkspaceFiles(root, "**/*.ts")).map((file) =>
          toRootRelativePath(root, file),
        ),
      ).toEqual(["inside.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
