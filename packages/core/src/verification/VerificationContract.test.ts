import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { VerificationContractManager } from "./VerificationContractManager.js";
import { CheckpointManager } from "@orbit-build/sandbox";
import { execSync } from "child_process";

describe("VerificationContractManager Tests", () => {
  let cwd: string;
  let cpManager: CheckpointManager;

  beforeEach(() => {
    cwd = path.join(tmpdir(), `orbit-verify-test-${Date.now()}`);
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(path.join(cwd, ".orbit"), { recursive: true });

    cpManager = new CheckpointManager(cwd, "test-session");
  });

  afterEach(() => {
    if (fs.existsSync(cwd)) {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("should return true/success if no contract exists", async () => {
    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      true,
    );
    manager.initialize();
    expect(manager.hasContract()).toBe(false);

    const res = await manager.runVerification();
    expect(res.success).toBe(true);
  });

  it("should run verification suite commands and report failure if exit code is non-zero", async () => {
    // Write contract with failing command
    fs.writeFileSync(
      path.join(cwd, ".orbit", "verification.json"),
      JSON.stringify({
        suites: {
          testCommand: 'node -e "process.exit(1)"',
        },
      }),
      "utf8",
    );

    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      true,
    );
    manager.initialize();
    expect(manager.hasContract()).toBe(true);

    const res = await manager.runVerification();
    expect(res.success).toBe(false);
    expect(res.error).toContain("testCommand");
  });

  it("exposes a bounded contract-specific repair budget", () => {
    fs.writeFileSync(
      path.join(cwd, ".orbit", "verification.json"),
      JSON.stringify({ maxRepairAttempts: 5 }),
      "utf8",
    );
    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      true,
    );
    manager.initialize();

    expect(manager.getMaxRepairAttempts()).toBe(5);
  });

  it("rejects oversized verification contracts", () => {
    fs.writeFileSync(
      path.join(cwd, ".orbit", "verification.json"),
      "x".repeat(1_048_577),
      "utf8",
    );
    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      true,
    );

    manager.initialize();

    expect(manager.hasContract()).toBe(false);
  });

  it("should verify required files presence", async () => {
    fs.writeFileSync(
      path.join(cwd, ".orbit", "verification.json"),
      JSON.stringify({
        requiredFiles: ["dist/bundle.js"],
      }),
      "utf8",
    );

    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      true,
    );
    manager.initialize();

    // First run (file missing -> fails)
    const res1 = await manager.runVerification();
    expect(res1.success).toBe(false);
    expect(res1.error).toContain("dist/bundle.js");

    // Create file
    fs.mkdirSync(path.join(cwd, "dist"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "dist", "bundle.js"), "content", "utf8");

    // Second run (file exists -> succeeds)
    const res2 = await manager.runVerification();
    expect(res2.success).toBe(true);
  });

  it("should enforce bounds on modified files using git status", async () => {
    fs.writeFileSync(
      path.join(cwd, ".orbit", "verification.json"),
      JSON.stringify({
        allowedModifiedFiles: ["src/**/*.ts"],
      }),
      "utf8",
    );

    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      true,
    );
    manager.initialize();

    // Initialize dummy git repo
    try {
      execSync("git init", { cwd, stdio: "ignore" });
      execSync("git config user.name test", { cwd, stdio: "ignore" });
      execSync("git config user.email test@example.com", {
        cwd,
        stdio: "ignore",
      });
    } catch {
      // If git is not installed, skip git-specific assertion
      return;
    }

    // Create allowed file
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "index.ts"), "code", "utf8");

    // Create disallowed file
    fs.writeFileSync(path.join(cwd, "disallowed.txt"), "oops", "utf8");

    const res = await manager.runVerification();
    expect(res.success).toBe(false);
    expect(res.error).toContain("disallowed.txt");
  });

  it("accepts allowed modified filenames containing spaces", async () => {
    fs.writeFileSync(
      path.join(cwd, ".orbit", "verification.json"),
      JSON.stringify({ allowedModifiedFiles: ["src/**/*.ts"] }),
      "utf8",
    );
    try {
      execSync("git init", { cwd, stdio: "ignore" });
    } catch {
      return;
    }
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "file with spaces.ts"), "code");

    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      true,
    );
    manager.initialize();

    await expect(manager.runVerification()).resolves.toEqual({
      success: true,
    });
  });

  it("redacts credentials from failed suite output", async () => {
    const credential = "sk-abcdefghijklmnopqrstuvwxyz1234567890";
    fs.writeFileSync(
      path.join(cwd, ".orbit", "verification.json"),
      JSON.stringify({
        suites: {
          secret: `node -e "console.error('${credential}'); process.exit(1)"`,
        },
      }),
      "utf8",
    );
    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      true,
    );
    manager.initialize();

    const result = await manager.runVerification();
    expect(result.success).toBe(false);
    expect(result.error).not.toContain(credential);
    expect(result.error).toContain("REDACTED");
  });

  it("ignores repository verification commands unless project executables are trusted", () => {
    fs.writeFileSync(
      path.join(cwd, ".orbit", "verification.json"),
      JSON.stringify({ suites: { unsafe: 'node -e "process.exit(1)"' } }),
      "utf8",
    );

    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      false,
    );
    manager.initialize();

    expect(manager.hasContract()).toBe(false);
  });

  it("rejects required files outside the workspace", async () => {
    fs.writeFileSync(
      path.join(cwd, ".orbit", "verification.json"),
      JSON.stringify({ requiredFiles: ["../outside.txt"] }),
      "utf8",
    );
    const manager = new VerificationContractManager(
      cwd,
      "test-session",
      cpManager,
      true,
    );
    manager.initialize();

    const result = await manager.runVerification();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside workspace boundary/i);
  });
});
