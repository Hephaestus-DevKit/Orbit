import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  promises as fs,
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
    vi.restoreAllMocks();
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

  it.each([
    ["pnpm@10.34.5", "pnpm test"],
    ["yarn@4.9.0", "yarn test"],
    ["bun@1.2.0", "bun run test"],
    ["npm@11.0.0", "npm run test"],
  ])(
    "honors the declared %s runner without a lockfile",
    async (packageManager, command) => {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ packageManager, scripts: { test: "vitest run" } }),
      );

      await scaffoldAgentProject(cwd);

      expect(
        JSON.parse(readFileSync(join(cwd, ".orbit/verification.json"), "utf8"))
          .suites.test,
      ).toBe(command);
    },
  );

  it.each([
    ["yarn.lock", "yarn test"],
    ["bun.lock", "bun run test"],
    ["bun.lockb", "bun run test"],
    ["package-lock.json", "npm run test"],
    ["npm-shrinkwrap.json", "npm run test"],
  ])("uses an unambiguous %s lockfile", async (lockfile, command) => {
    writeFileSync(join(cwd, lockfile), "");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );

    await scaffoldAgentProject(cwd);

    expect(
      JSON.parse(readFileSync(join(cwd, ".orbit/verification.json"), "utf8"))
        .suites.test,
    ).toBe(command);
  });

  it("prefers packageManager to stale lockfiles and explains the conflict", async () => {
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        packageManager: "npm@11.0.0",
        scripts: { test: "vitest run" },
      }),
    );

    const result = await scaffoldAgentProject(cwd);

    expect(
      readFileSync(join(cwd, ".orbit/verification.json"), "utf8"),
    ).toContain("npm run test");
    expect(result.warnings.join(" ")).toContain("Lockfiles disagree");
  });

  it("does not guess a runner from conflicting lockfiles", async () => {
    writeFileSync(join(cwd, "pnpm-lock.yaml"), "");
    writeFileSync(join(cwd, "package-lock.json"), "{}");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );

    const result = await scaffoldAgentProject(cwd);

    expect(result.ecosystems).toEqual(["Node.js"]);
    expect(result.verificationSuites).toEqual([]);
    expect(result.warnings.join(" ")).toContain(
      "Multiple package-manager lockfiles",
    );
    expect(existsSync(join(cwd, ".orbit/verification.json"))).toBe(false);
  });

  it.each(["pnpm", "custom@1.0.0", "pnpm@10 && echo secret"])(
    "does not guess commands for an invalid or unsupported packageManager",
    async (packageManager) => {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ packageManager, scripts: { test: "vitest run" } }),
      );

      const result = await scaffoldAgentProject(cwd);

      expect(result.verificationSuites).toEqual([]);
      expect(result.warnings.join(" ")).toContain(
        "packageManager is unsupported or invalid",
      );
      expect(result.warnings.join(" ")).not.toContain("secret");
    },
  );

  it.each(["{broken", JSON.stringify({ scripts: { test: 42 } })])(
    "warns about malformed manifests without preventing safe initialization",
    async (manifest) => {
      writeFileSync(join(cwd, "package.json"), manifest);

      const result = await scaffoldAgentProject(cwd);

      expect(result.verificationSuites).toEqual([]);
      expect(result.warnings.join(" ")).toContain(
        "Node.js verification commands were not inferred",
      );
      expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe(manifest);
      expect(existsSync(join(cwd, "ORBIT.md"))).toBe(true);
    },
  );

  it("distinguishes preserved verification from newly generated candidates", async () => {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    mkdirSync(join(cwd, ".orbit"));
    const reviewed = '{"suites":{"reviewed":"npm run test:ci"}}\n';
    writeFileSync(join(cwd, ".orbit/verification.json"), reviewed);

    const result = await scaffoldAgentProject(cwd);

    expect(readFileSync(join(cwd, ".orbit/verification.json"), "utf8")).toBe(
      reviewed,
    );
    expect(result.warnings).toEqual([
      "Existing .orbit/verification.json was preserved; inferred verification candidates were not applied.",
    ]);
  });

  it.each([
    "ORBIT.md",
    ".orbit/verification.json",
    ".orbit/commands/review.md",
  ])(
    "rejects a directory at the file target %s before writing other files",
    async (target) => {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
      );
      mkdirSync(join(cwd, target), { recursive: true });

      await expect(scaffoldAgentProject(cwd)).rejects.toThrow(
        /must be a regular file/,
      );

      if (target !== "ORBIT.md")
        expect(existsSync(join(cwd, "ORBIT.md"))).toBe(false);
      expect(existsSync(join(cwd, ".orbit/commands/implement.md"))).toBe(false);
    },
  );

  it.each([".orbit", ".orbit/commands"])(
    "rejects a file at the parent %s before writing anything",
    async (target) => {
      if (target !== ".orbit") mkdirSync(join(cwd, ".orbit"));
      writeFileSync(join(cwd, target), "user-owned\n");

      await expect(scaffoldAgentProject(cwd)).rejects.toThrow(
        /must be a directory/,
      );

      expect(readFileSync(join(cwd, target), "utf8")).toBe("user-owned\n");
      expect(existsSync(join(cwd, "ORBIT.md"))).toBe(false);
    },
  );

  it("only preflights requested files in minimal mode", async () => {
    writeFileSync(join(cwd, ".orbit"), "unrelated\n");

    const result = await scaffoldAgentProject(cwd, { minimal: true });

    expect(result.files).toEqual([
      { path: "ORBIT.md", status: "created", purpose: "agent-contract" },
    ]);
    expect(readFileSync(join(cwd, ".orbit"), "utf8")).toBe("unrelated\n");
  });

  it("supports concurrent initialization without overwriting files", async () => {
    const results = await Promise.all([
      scaffoldAgentProject(cwd),
      scaffoldAgentProject(cwd),
    ]);
    for (const path of [
      "ORBIT.md",
      ".orbit/commands/implement.md",
      ".orbit/commands/review.md",
    ]) {
      expect(
        results
          .flatMap((result) => result.files)
          .filter((file) => file.path === path && file.status === "created"),
      ).toHaveLength(1);
      expect(readFileSync(join(cwd, path), "utf8").length).toBeGreaterThan(100);
    }
  });

  it("removes a failed write and safely resumes initialization on retry", async () => {
    const originalOpen = fs.open.bind(fs);
    const open = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const file = await originalOpen(...args);
      if (String(args[0]).endsWith("review.md")) {
        const write = file.writeFile.bind(file);
        vi.spyOn(file, "writeFile").mockImplementationOnce(async () => {
          await write("incomplete");
          throw new Error("Write interrupted");
        });
      }
      return file;
    });
    await expect(scaffoldAgentProject(cwd)).rejects.toThrow(
      "Write interrupted",
    );
    expect(existsSync(join(cwd, ".orbit/commands/review.md"))).toBe(false);
    const contract = readFileSync(join(cwd, "ORBIT.md"), "utf8");
    open.mockRestore();
    const result = await scaffoldAgentProject(cwd);
    expect(readFileSync(join(cwd, "ORBIT.md"), "utf8")).toBe(contract);
    expect(
      result.files.find((file) => file.path === ".orbit/commands/review.md")
        ?.status,
    ).toBe("created");
    expect(
      readFileSync(join(cwd, ".orbit/commands/review.md"), "utf8"),
    ).toContain("read-only engineering audit");
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
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
          lint: "   ",
        },
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
      expect(existsSync(join(cwd, "ORBIT.md"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
