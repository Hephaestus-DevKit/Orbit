import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScreenReaderOutputGuard,
  stripScreenReaderControls,
} from "./ScreenReaderOutputGuard.js";

describe("ScreenReaderOutputGuard", () => {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;

  afterEach(() => {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    vi.restoreAllMocks();
  });

  it("removes ANSI, hyperlinks, cursor returns, and unsafe controls", () => {
    expect(
      stripScreenReaderControls(
        "\x1b[31mfailed\x1b[0m\r\x1b]8;;https://example.test\x07link\x1b]8;;\x07\u0000",
      ),
    ).toBe("failed\nlink");
  });

  it("starts idempotently and restores both process streams", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const baseStdout = vi.fn((chunk: string | Uint8Array) => {
      if (String(chunk)) stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const baseStderr = vi.fn((chunk: string | Uint8Array) => {
      if (String(chunk)) stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = baseStdout;
    process.stderr.write = baseStderr;
    const guard = new ScreenReaderOutputGuard();

    guard.start();
    const guardedStdout = process.stdout.write;
    guard.start();
    expect(process.stdout.write).toBe(guardedStdout);
    process.stdout.write("\x1b[32mok\x1b[0m\r");
    process.stdout.write("\x1b[31");
    process.stdout.write("mred\x1b[0m");
    process.stderr.write("\x1b[31merror\x1b[0m");
    guard.stop();

    expect(stdout).toEqual(["ok\n", "red"]);
    expect(stderr).toEqual(["error"]);
    expect(process.stdout.write).toBe(baseStdout);
    expect(process.stderr.write).toBe(baseStderr);
  });
});
