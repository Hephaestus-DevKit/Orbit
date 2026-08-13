import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scaffoldAgentProject } from "./ProjectScaffolder.js";

describe("scaffoldAgentProject", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-project-scaffold-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("creates an Agent contract, inferred verification, and focused workflows", async () => {
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "eslint .",
          typecheck: "tsc --noEmit",
          test: "vitest run",
          build: "tsup",
        },
      }),
    );

    const result = await scaffoldAgentProject(cwd);

    expect(result.ecosystems).toEqual(["Node.js"]);
    expect(result.verificationSuites).toEqual([
      "lint",
      "typecheck",
      "test",
      "build",
    ]);
    expect(readFileSync(join(cwd, "ORBIT.md"), "utf8")).toContain(
      "Treat each request as an outcome to deliver",
    );
    expect(
      JSON.parse(
        readFileSync(join(cwd, ".orbit", "verification.json"), "utf8"),
      ),
    ).toMatchObject({
      suites: {
        lint: "pnpm lint",
        typecheck: "pnpm typecheck",
        test: "pnpm test",
        build: "pnpm build",
      },
      maxRepairAttempts: 3,
    });
    expect(
      readFileSync(join(cwd, ".orbit", "commands", "implement.md"), "utf8"),
    ).toContain("$ARGUMENTS");
    expect(result.warnings.join(" ")).toContain("trustProjectExecutables");
  });

  it("is repeatable without overwriting reviewed project guidance", async () => {
    writeFileSync(join(cwd, "ORBIT.md"), "# Hand-authored rules\n");

    const first = await scaffoldAgentProject(cwd);
    const second = await scaffoldAgentProject(cwd);

    expect(readFileSync(join(cwd, "ORBIT.md"), "utf8")).toBe(
      "# Hand-authored rules\n",
    );
    expect(first.files.find((file) => file.path === "ORBIT.md")?.status).toBe(
      "existing",
    );
    expect(second.files.every((file) => file.status === "existing")).toBe(true);
  });

  it("keeps minimal initialization compatible with the legacy command", async () => {
    const result = await scaffoldAgentProject(cwd, { minimal: true });

    expect(result.files.map((file) => file.path)).toEqual(["ORBIT.md"]);
    expect(existsSync(join(cwd, ".orbit"))).toBe(false);
  });

  it("does not create an empty verification contract from placeholder scripts", async () => {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    );

    const result = await scaffoldAgentProject(cwd);

    expect(result.verificationSuites).toEqual([]);
    expect(existsSync(join(cwd, ".orbit", "verification.json"))).toBe(false);
  });

  it("rejects a scaffold directory linked outside the workspace", async () => {
    const outside = mkdtempSync(
      join(tmpdir(), "orbit-project-scaffold-outside-"),
    );
    try {
      mkdirSync(join(cwd, ".orbit"));
      symlinkSync(
        outside,
        join(cwd, ".orbit", "commands"),
        process.platform === "win32" ? "junction" : "dir",
      );

      await expect(scaffoldAgentProject(cwd)).rejects.toThrow(
        /symbolic link|junction|outside workspace/i,
      );
      expect(existsSync(join(outside, "implement.md"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
