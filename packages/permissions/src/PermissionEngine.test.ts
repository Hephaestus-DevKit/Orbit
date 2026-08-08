import { describe, it, expect } from "vitest";
import { PermissionEngine } from "./PermissionEngine.js";
import { OrbitConfig } from "@orbit-build/config";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import os from "os";
import path from "path";

const mockConfig = (
  mode: "strict" | "normal" | "auto" | "plan",
): OrbitConfig => ({
  schemaVersion: 1,
  name: "test",
  provider: { default: "deepseek-openai" },
  models: {
    default: "foo",
    fast: "foo",
    planner: "foo",
    coder: "foo",
    reviewer: "foo",
    summarizer: "foo",
  },
  providers: {},
  permissions: {
    mode,
    allowRead: true,
    requireApprovalForWrite: true,
    requireApprovalForBash: true,
    blockDangerousCommands: true,
    protectSecrets: true,
    protectedPaths: [".env", "id_rsa"],
  },
  context: {
    maxFilesToIndex: 100,
    maxFileSizeKb: 10,
    ignore: [],
    autoCompact: false,
    compactThreshold: 0.8,
  },
  tools: {
    bash: { enabled: true, timeoutMs: 1000 },
    webSearch: { enabled: false },
    mcp: { enabled: false },
  },
  session: { store: "sqlite", path: "foo.db" },
});

describe("PermissionEngine tests", () => {
  it("should allow read tools in all modes", () => {
    const engine = new PermissionEngine(mockConfig("normal"));
    const decision = engine.evaluate("read_file", { path: "src/main.ts" });
    expect(decision.action).toBe("allow");
  });

  it("should require prompt for write tools in normal/strict modes", () => {
    const engine = new PermissionEngine(mockConfig("normal"));
    const decision = engine.evaluate("write_file", {
      path: "src/main.ts",
      content: "hello",
    });
    expect(decision.action).toBe("ask");
  });

  it("should block dangerous operations under normal/strict/auto modes", () => {
    const engine = new PermissionEngine(mockConfig("normal"));
    for (const command of [
      "rm -rf /",
      "rm -fr ./build",
      "rm -Rfv ./build",
      "rm ./build --recursive",
      "rmdir ./build -Recurse -Force",
      "ri ./build -r -fo",
    ]) {
      expect(engine.evaluate("bash", { command }).action, command).toBe("deny");
    }
  });

  it("should block access to protected files under strict mode, but prompt under normal", () => {
    const strictEngine = new PermissionEngine(mockConfig("strict"));
    const normalEngine = new PermissionEngine(mockConfig("normal"));

    expect(strictEngine.evaluate("read_file", { path: ".env" }).action).toBe(
      "deny",
    );
    expect(normalEngine.evaluate("read_file", { path: ".env" }).action).toBe(
      "ask",
    );
  });

  it("should classify write aliases as write operations", () => {
    const engine = new PermissionEngine(mockConfig("normal"));
    expect(
      engine.evaluate("replace_file_content", {
        TargetFile: "src/main.ts",
      }).action,
    ).toBe("ask");
    expect(
      engine.evaluate("multi_replace_file_content", {
        filePath: "src/main.ts",
      }).action,
    ).toBe("ask");
  });

  it("should recognize Windows destructive and network commands", () => {
    const config = mockConfig("auto");
    config.permissions.requireApprovalForBash = false;
    const engine = new PermissionEngine(config);
    expect(
      engine.evaluate("bash", {
        command: "Remove-Item .\\build -Recurse -Force",
      }).action,
    ).toBe("deny");
    expect(
      engine.evaluate("bash", {
        command: "Invoke-WebRequest https://example.com",
      }).action,
    ).toBe("allow");
  });

  it("should treat web search as a network operation", () => {
    const normalEngine = new PermissionEngine(mockConfig("normal"));
    const strictEngine = new PermissionEngine(mockConfig("strict"));
    const autoConfig = mockConfig("auto");
    autoConfig.permissions.requireApprovalForWrite = false;
    autoConfig.permissions.requireApprovalForBash = false;
    const autoEngine = new PermissionEngine(autoConfig);

    expect(
      normalEngine.evaluate("web_search", { query: "Orbit docs" }, "network")
        .action,
    ).toBe("ask");
    expect(
      strictEngine.evaluate("web_search", { query: "Orbit docs" }, "network")
        .action,
    ).toBe("deny");
    expect(
      autoEngine.evaluate("web_search", { query: "Orbit docs" }, "network")
        .action,
    ).toBe("allow");
  });

  it("allows model task-plan bookkeeping without a project-write prompt", () => {
    const engine = new PermissionEngine(mockConfig("strict"));

    expect(
      engine.evaluate(
        "update_plan",
        {
          plan: [{ step: "Inspect the project", status: "in_progress" }],
        },
        "write",
      ),
    ).toMatchObject({ action: "allow", risk: "write" });
  });

  it("honors approval flags even in auto mode", () => {
    const config = mockConfig("auto");
    const engine = new PermissionEngine(config);

    expect(engine.evaluate("write_file", { path: "src/main.ts" }).action).toBe(
      "ask",
    );
    expect(engine.evaluate("bash", { command: "npm test" }).action).toBe("ask");
  });

  it("classifies a custom run_tests command using bash safety rules", () => {
    const config = mockConfig("auto");
    config.permissions.requireApprovalForBash = false;
    const engine = new PermissionEngine(config);

    expect(engine.evaluate("run_tests", { command: "rm -rf /" }).action).toBe(
      "deny",
    );
  });

  it("honors read and secret protection flags", () => {
    const config = mockConfig("auto");
    config.permissions.allowRead = false;
    expect(
      new PermissionEngine(config).evaluate("read_file", { path: "README.md" })
        .action,
    ).toBe("deny");

    config.permissions.allowRead = true;
    config.permissions.protectSecrets = false;
    expect(
      new PermissionEngine(config).evaluate("read_file", { path: ".env" })
        .action,
    ).toBe("allow");
  });

  it("handles malformed tool arguments without crashing", () => {
    const engine = new PermissionEngine(mockConfig("normal"));

    expect(engine.evaluate("read_file", null).action).toBe("allow");
    expect(engine.evaluate("bash", "not-an-object").action).toBe("ask");
  });
});

describe("bash path-boundary and protected-path enforcement", () => {
  const workspaceRoot = "/workspace/project";
  const autoConfig = () => {
    const config = mockConfig("auto");
    config.permissions.requireApprovalForBash = false;
    return config;
  };

  it("asks before bash reads a protected file even under auto mode", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);

    const decision = engine.evaluate("bash", { command: "cat .env" });
    expect(decision.action).toBe("ask");
    expect(decision.reason).toContain(".env");
  });

  it("denies bash access to protected files under strict mode", () => {
    const engine = new PermissionEngine(mockConfig("strict"), workspaceRoot);

    const decision = engine.evaluate("bash", { command: "cat .env" });
    expect(decision.action).toBe("deny");
    expect(decision.reason).toContain(".env");
  });

  it("asks before bash touches paths outside the workspace under auto mode", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);

    expect(engine.evaluate("bash", { command: "cat /etc/passwd" }).action).toBe(
      "ask",
    );
    expect(
      engine.evaluate("bash", { command: "echo data > ../outside.txt" }).action,
    ).toBe("ask");
  });

  it("does not let workspace links bypass shell path boundaries", () => {
    const fixtureRoot = mkdtempSync(
      path.join(os.tmpdir(), "orbit-permission-link-"),
    );
    try {
      const workspace = path.join(fixtureRoot, "workspace");
      const outside = path.join(fixtureRoot, "outside");
      const linked = path.join(workspace, "linked-outside");
      mkdirSync(workspace);
      mkdirSync(outside);
      symlinkSync(
        outside,
        linked,
        process.platform === "win32" ? "junction" : "dir",
      );

      const autoDecision = new PermissionEngine(
        autoConfig(),
        workspace,
      ).evaluate("bash", {
        command: `cat "${path.join(linked, "secret.txt")}"`,
      });
      expect(autoDecision.action).toBe("ask");
      expect(autoDecision.reason).toContain("symbolic link or junction");

      const strictDecision = new PermissionEngine(
        mockConfig("strict"),
        workspace,
      ).evaluate("bash", {
        command: `cat "${path.join(linked, "secret.txt")}"`,
      });
      expect(strictDecision.action).toBe("deny");
      expect(strictDecision.reason).toContain("does not resolve safely");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("detects paths attached to shell redirection operators", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);

    expect(
      engine.evaluate("bash", { command: "echo secret>.env" }).action,
    ).toBe("ask");
    expect(
      engine.evaluate("bash", { command: "echo data>../outside.txt" }).action,
    ).toBe("ask");
  });

  it("does not silently allow unresolved path expansions", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);

    const decision = engine.evaluate("bash", {
      command: "cat $UNTRUSTED_ROOT/secrets.txt",
    });
    expect(decision.action).toBe("ask");
    expect(decision.reason).toContain("runtime expansion");
  });

  it("expands home-directory prefixes before the boundary check", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);

    const decision = engine.evaluate("bash", {
      command: "cat ~/Documents/notes.txt",
    });
    expect(decision.action).toBe("ask");
    expect(decision.reason).toContain("outside the workspace");
  });

  it("still auto-allows ordinary workspace commands", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);

    expect(
      engine.evaluate("bash", { command: "node src/index.js --verbose" })
        .action,
    ).toBe("allow");
    expect(
      engine.evaluate("bash", { command: "echo https://example.com/docs" })
        .action,
    ).toBe("allow");
    expect(
      engine.evaluate("bash", {
        command: "ls code/q2 2>/dev/null",
      }).action,
    ).toBe("allow");
  });

  it("requires confirmation for opaque interpreter and nested-shell commands", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);
    const commands = [
      "sh -c 'cat .env'",
      'node -e \'require("fs").readFileSync(".env")\'',
      'python -c \'open("../outside.txt", "w").write("x")\'',
      'powershell -Command "Get-Content $env:USERPROFILE/.ssh/id_rsa"',
      "env TARGET=../outside.txt cat $TARGET",
      "echo $(cat .env)",
      "node --eval=\"require('fs').readFileSync('.env')\"",
      "pnpm exec node -p=\"require('fs').readFileSync('.env')\"",
      'echo ready; node -e "process.exit(0)"',
      "pnpm test && cat ../outside.txt",
    ];

    for (const command of commands) {
      const decision = engine.evaluate("bash", { command });
      expect(decision.action, command).not.toBe("allow");
    }
  });

  it("denies opaque interpreter commands under strict mode", () => {
    const engine = new PermissionEngine(mockConfig("strict"), workspaceRoot);
    const decision = engine.evaluate("bash", {
      command: "python -c 'print(open(\".env\").read())'",
    });

    expect(decision.action).toBe("deny");
    expect(decision.reason).toContain("statically bounded");
  });

  it("allows active validated Skill roots without weakening other boundaries", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);
    const skillRoot = "/home/test/.orbit/skills/math-draft";
    engine.setTrustedRoots([skillRoot]);

    expect(
      engine.evaluate("bash", {
        command: `${skillRoot}/scripts/bootstrap.py .`,
      }).action,
    ).toBe("allow");
    expect(engine.evaluate("bash", { command: "cat /etc/passwd" }).action).toBe(
      "ask",
    );
  });

  it("allows Full Access tooling roots and temporary outputs without weakening normal mode", () => {
    const auto = new PermissionEngine(autoConfig(), workspaceRoot);
    const temporaryOutput = path.join(os.tmpdir(), "orbit-layout-check.log");
    const executable = process.execPath;

    expect(
      auto.evaluate("bash", {
        command: `"${executable}" --version > "${temporaryOutput}"`,
      }).action,
    ).toBe("allow");

    const normal = mockConfig("normal");
    normal.permissions.requireApprovalForBash = false;
    const guarded = new PermissionEngine(normal, workspaceRoot);
    expect(
      guarded.evaluate("bash", {
        command: `"${executable}" --version > "${temporaryOutput}"`,
      }).action,
    ).toBe("ask");
  });

  it("does not mistake escaped regular-expression fragments for paths", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);
    expect(
      engine.evaluate("bash", {
        command: String.raw`grep "Overfull \\hbox|\[RUN\]" paper/build/main.log`,
      }).action,
    ).toBe("allow");
  });

  it.runIf(process.platform === "win32")(
    "recognizes MSYS drive paths for active Windows Skill roots",
    () => {
      const engine = new PermissionEngine(
        autoConfig(),
        "C:\\workspace\\project",
      );
      engine.setTrustedRoots([
        "C:\\Users\\Jiehu Wang\\.orbit\\skills\\math-model-draft",
      ]);

      expect(
        engine.evaluate("bash", {
          command:
            'python "/c/Users/Jiehu Wang/.orbit/skills/math-model-draft/scripts/inspect_inputs.py" .',
        }).action,
      ).toBe("allow");
      expect(
        engine.evaluate("bash", {
          command: 'cat "/c/Windows/System32/config/SAM"',
        }).action,
      ).toBe("ask");
    },
  );

  it("applies the same policy to run_tests commands", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);

    const decision = engine.evaluate("run_tests", {
      command: "pytest /outside/tests",
    });
    expect(decision.action).toBe("ask");
  });

  it("keeps dangerous-command blocking ahead of path prompts", () => {
    const engine = new PermissionEngine(autoConfig(), workspaceRoot);

    const decision = engine.evaluate("bash", {
      command: "rm -rf /etc/passwd",
    });
    expect(decision.action).toBe("deny");
  });

  it("skips boundary checks when no workspace root is provided", () => {
    const engine = new PermissionEngine(autoConfig());

    expect(engine.evaluate("bash", { command: "cat /etc/passwd" }).action).toBe(
      "allow",
    );
  });
});
