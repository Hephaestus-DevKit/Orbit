import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeLocalPackageBinary,
  resolveLocalPackageBinary,
} from "./LocalPackageBinary.js";

describe("resolveLocalPackageBinary", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function createPackage(bin: string, binarySource = "export {};"): string {
    const root = mkdtempSync(join(tmpdir(), "orbit-local-bin-"));
    roots.push(root);
    const packageRoot = join(root, "node_modules", "demo-package");
    mkdirSync(join(packageRoot, "bin"), { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "demo-package",
        main: "index.js",
        bin: { demo: bin },
      }),
      "utf8",
    );
    writeFileSync(join(packageRoot, "index.js"), "export {};", "utf8");
    writeFileSync(join(packageRoot, "bin", "demo.js"), binarySource, "utf8");
    writeFileSync(join(root, "package.json"), '{"type":"module"}', "utf8");
    return root;
  }

  it("resolves a regular binary inside the installed package", () => {
    const root = createPackage("bin/demo.js");

    expect(resolveLocalPackageBinary(root, "demo-package", "demo")).toBe(
      realpathSync(
        join(root, "node_modules", "demo-package", "bin", "demo.js"),
      ).replace(/\\/g, "/"),
    );
  });

  it("rejects a package manifest binary that escapes its package root", () => {
    const root = createPackage("../../outside.js");
    writeFileSync(join(root, "outside.js"), "export {};", "utf8");

    expect(() =>
      resolveLocalPackageBinary(root, "demo-package", "demo"),
    ).toThrow("outside workspace boundary");
  });

  it("passes exact argv to the policy-controlled executor without a shell", async () => {
    const root = createPackage("bin/demo.js");
    const execute = vi.fn(async () => ({ stdout: "checked", stderr: "" }));

    const result = await executeLocalPackageBinary(
      root,
      "demo-package",
      "demo",
      ["file with spaces; literal.ts"],
      execute,
    );

    expect(result.stdout).toBe("checked");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        invocation: {
          file: process.execPath,
          args: [
            resolveLocalPackageBinary(root, "demo-package", "demo"),
            "file with spaces; literal.ts",
          ],
        },
      }),
    );
  });
});
