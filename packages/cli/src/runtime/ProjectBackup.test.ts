import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProjectBackup,
  readProjectBackup,
  restoreProjectBackup,
  writeProjectBackup,
} from "./ProjectBackup.js";

describe("ProjectBackup", () => {
  let source: string;
  let destination: string;

  beforeEach(() => {
    source = mkdtempSync(join(tmpdir(), "orbit-backup-source-"));
    destination = mkdtempSync(join(tmpdir(), "orbit-backup-target-"));
    mkdirSync(join(source, ".orbit", "sessions", "session-1"), {
      recursive: true,
    });
    mkdirSync(join(source, ".orbit", "cache-slabs"), { recursive: true });
    writeFileSync(
      join(source, ".orbit", "sessions", "session-1", "session.json"),
      '{"id":"session-1"}',
    );
    writeFileSync(join(source, ".orbit", "memory.json"), '{"facts":[]}');
    writeFileSync(join(source, ".orbit", "symbols.json"), "generated");
    writeFileSync(join(source, ".orbit", "cache-slabs", "cache.json"), "x");
  });

  afterEach(() => {
    rmSync(source, { recursive: true, force: true });
    rmSync(destination, { recursive: true, force: true });
  });

  it("exports durable project data and excludes regenerable caches", () => {
    mkdirSync(join(source, ".orbit", ".restore-interrupted"));
    writeFileSync(
      join(source, ".orbit", ".restore-interrupted", "previous.json"),
      "recovery-only",
    );
    const bundle = createProjectBackup(source);
    expect(bundle.files.map((file) => file.path)).toEqual([
      "memory.json",
      "sessions/session-1/session.json",
    ]);
    expect(JSON.stringify(bundle)).not.toContain("generated");
    expect(JSON.stringify(bundle)).not.toContain("recovery-only");
  });

  it("writes, validates, and restores a portable bundle", () => {
    const backupPath = join(source, "project.orbit-backup.json");
    writeProjectBackup(backupPath, createProjectBackup(source));
    const result = restoreProjectBackup(
      destination,
      readProjectBackup(backupPath),
    );

    expect(result.restored).toHaveLength(2);
    expect(
      readFileSync(
        join(destination, ".orbit", "sessions", "session-1", "session.json"),
        "utf8",
      ),
    ).toContain("session-1");
    expect(existsSync(join(destination, ".orbit", "symbols.json"))).toBe(false);
  });

  it("rejects tampered content before writing", () => {
    const bundle = createProjectBackup(source);
    bundle.files[0]!.content = Buffer.from("tampered").toString("base64");
    expect(() => restoreProjectBackup(destination, bundle)).toThrow(
      /integrity check failed/i,
    );
    expect(existsSync(join(destination, ".orbit"))).toBe(false);
  });

  it("refuses existing files unless force is explicit", () => {
    const bundle = createProjectBackup(source);
    mkdirSync(join(destination, ".orbit"), { recursive: true });
    writeFileSync(join(destination, ".orbit", "memory.json"), "keep");

    expect(() => restoreProjectBackup(destination, bundle)).toThrow(/--force/);
    expect(
      readFileSync(join(destination, ".orbit", "memory.json"), "utf8"),
    ).toBe("keep");

    const result = restoreProjectBackup(destination, bundle, { force: true });
    expect(result.conflicts).toEqual(["memory.json"]);
    expect(
      readFileSync(join(destination, ".orbit", "memory.json"), "utf8"),
    ).toBe('{"facts":[]}');
    expect(
      readdirSync(join(destination, ".orbit")).some((name) =>
        name.startsWith(".restore-"),
      ),
    ).toBe(false);
  });

  it("preflights every target before a multi-file restore writes anything", () => {
    const bundle = createProjectBackup(source);
    const blockedTarget = join(
      destination,
      ".orbit",
      "sessions",
      "session-1",
      "session.json",
    );
    mkdirSync(blockedTarget, { recursive: true });

    expect(() =>
      restoreProjectBackup(destination, bundle, { force: true }),
    ).toThrow(/regular, non-symlink file/);
    expect(existsSync(join(destination, ".orbit", "memory.json"))).toBe(false);
  });

  it("rejects traversal paths even if the object bypasses TypeScript", () => {
    const bundle = createProjectBackup(source);
    bundle.files[0]!.path = "../outside.json";
    expect(() => restoreProjectBackup(destination, bundle)).toThrow(
      /unsafe backup path/i,
    );
  });

  it("rejects oversized source and serialized backup files before loading", () => {
    const sourcePath = join(source, ".orbit", "too-large.bin");
    writeFileSync(sourcePath, "");
    truncateSync(sourcePath, 64 * 1024 * 1024 + 1);
    expect(() => createProjectBackup(source)).toThrow(/exceeds/i);

    const serializedPath = join(source, "oversized.orbit-backup.json");
    writeFileSync(serializedPath, "");
    truncateSync(serializedPath, 96 * 1024 * 1024 + 1);
    expect(() => readProjectBackup(serializedPath)).toThrow(/limit/i);
  });

  it("bounds pathological backup directory depth", () => {
    let directory = join(source, ".orbit", "deep");
    mkdirSync(directory);
    for (let depth = 0; depth < 65; depth += 1) {
      directory = join(directory, "nested");
      mkdirSync(directory);
    }

    expect(() => createProjectBackup(source)).toThrow(/directory levels/i);
  });

  it.runIf(process.platform !== "win32")(
    "refuses restore through an existing symbolic-link directory",
    () => {
      mkdirSync(join(destination, ".orbit"), { recursive: true });
      const external = mkdtempSync(join(tmpdir(), "orbit-backup-external-"));
      try {
        symlinkSync(external, join(destination, ".orbit", "sessions"), "dir");
        expect(() =>
          restoreProjectBackup(destination, createProjectBackup(source)),
        ).toThrow(/symbolic link/i);
      } finally {
        rmSync(external, { recursive: true, force: true });
      }
    },
  );
});
