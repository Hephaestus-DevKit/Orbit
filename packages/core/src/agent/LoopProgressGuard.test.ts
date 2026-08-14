import { describe, expect, it } from "vitest";
import { LoopProgressGuard } from "./LoopProgressGuard.js";

const ok = (name: string, args: object) => ({
  name,
  arguments: JSON.stringify(args),
  ok: true,
});
const failed = (name: string, args: object) => ({
  name,
  arguments: JSON.stringify(args),
  ok: false,
});

describe("LoopProgressGuard", () => {
  it("nudges after three consecutive identical successful calls", () => {
    const guard = new LoopProgressGuard();
    expect(guard.record(ok("read_file", { path: "a.ts" }))).toBeNull();
    expect(guard.record(ok("read_file", { path: "a.ts" }))).toBeNull();
    const nudge = guard.record(ok("read_file", { path: "a.ts" }));
    expect(nudge?.reason).toBe("repeated_identical_call");
    expect(nudge?.repeatCount).toBe(3);
    expect(nudge?.message).toContain("read_file");
  });

  it("nudges earlier when identical calls keep failing", () => {
    const guard = new LoopProgressGuard();
    expect(guard.record(failed("edit_file", { path: "a.ts" }))).toBeNull();
    const nudge = guard.record(failed("edit_file", { path: "a.ts" }));
    expect(nudge?.reason).toBe("repeated_failure");
    expect(nudge?.repeatCount).toBe(2);
  });

  it("does not fire on legitimate interleaved repetition", () => {
    const guard = new LoopProgressGuard();
    // edit → test → edit → test is healthy even though the test call repeats.
    expect(guard.record(ok("edit_file", { path: "a.ts" }))).toBeNull();
    expect(guard.record(failed("bash", { command: "npm test" }))).toBeNull();
    expect(guard.record(ok("edit_file", { path: "a.ts" }))).toBeNull();
    expect(guard.record(failed("bash", { command: "npm test" }))).toBeNull();
    expect(guard.record(ok("edit_file", { path: "b.ts" }))).toBeNull();
    expect(guard.record(ok("bash", { command: "npm test" }))).toBeNull();
  });

  it("stays quiet after a nudge until the streak grows again", () => {
    const guard = new LoopProgressGuard();
    guard.record(ok("grep", { pattern: "x" }));
    guard.record(ok("grep", { pattern: "x" }));
    expect(guard.record(ok("grep", { pattern: "x" }))).not.toBeNull();
    expect(guard.record(ok("grep", { pattern: "x" }))).toBeNull();
    const renudge = guard.record(ok("grep", { pattern: "x" }));
    expect(renudge?.repeatCount).toBe(5);
  });

  it("treats reordered JSON keys as the same call", () => {
    const guard = new LoopProgressGuard();
    expect(
      guard.record({
        name: "grep",
        arguments: '{"pattern":"x","path":"src"}',
        ok: true,
      }),
    ).toBeNull();
    expect(
      guard.record({
        name: "grep",
        arguments: '{"path":"src","pattern":"x"}',
        ok: true,
      }),
    ).toBeNull();
    const nudge = guard.record({
      name: "grep",
      arguments: '{ "pattern": "x", "path": "src" }',
      ok: true,
    });
    expect(nudge?.reason).toBe("repeated_identical_call");
  });

  it("resets cleanly between tasks", () => {
    const guard = new LoopProgressGuard();
    guard.record(ok("grep", { pattern: "x" }));
    guard.record(ok("grep", { pattern: "x" }));
    guard.reset();
    expect(guard.record(ok("grep", { pattern: "x" }))).toBeNull();
    expect(guard.record(ok("grep", { pattern: "x" }))).toBeNull();
  });

  it("falls back to raw-string comparison for invalid JSON arguments", () => {
    const guard = new LoopProgressGuard();
    expect(
      guard.record({ name: "bash", arguments: "not json", ok: false }),
    ).toBeNull();
    const nudge = guard.record({
      name: "bash",
      arguments: "  not json  ",
      ok: false,
    });
    expect(nudge?.reason).toBe("repeated_failure");
  });

  it("nudges varied shell probes against the same file", () => {
    const guard = new LoopProgressGuard();
    expect(
      guard.record(
        ok("bash", { command: "Get-Content -LiteralPath 'paper/main.tex'" }),
      ),
    ).toBeNull();
    expect(
      guard.record(
        ok("bash", {
          command: "Select-String -LiteralPath 'paper/main.tex' -Pattern TODO",
        }),
      ),
    ).toBeNull();
    const nudge = guard.record(
      ok("bash", {
        command:
          "python -c \"print(open('paper/main.tex', encoding='utf-8').read()[:20])\"",
      }),
    );

    expect(nudge?.reason).toBe("repeated_probe");
    expect(nudge?.message).toContain("read_file once");
  });

  it("does not classify builds as read-only shell probes", () => {
    const guard = new LoopProgressGuard();
    for (let index = 0; index < 4; index += 1) {
      expect(
        guard.record(
          ok("bash", {
            command: `xelatex -output-directory=build paper/main.tex ${index}`,
          }),
        ),
      ).toBeNull();
    }
  });
});
