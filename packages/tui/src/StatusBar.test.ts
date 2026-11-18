import { afterEach, describe, expect, it, mockTools as vi } from "../../../scripts/testing/support.mjs";
import { StatusBar } from "./StatusBar.js";

describe("StatusBar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not emit ANSI control sequences in redirected output", () => {
    const originalWrite = process.stdout.write;
    const restoreTty = setTty(process.stdout, false);

    try {
      const status = new StatusBar();
      status.start("working");

      expect(process.stdout.write).toBe(originalWrite);
      status.stop();
    } finally {
      restoreTty();
    }
  });

  it("updates an already running status instead of ignoring the message", () => {
    vi.useFakeTimers();
    const restoreTty = setTty(process.stdout, true);
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const status = new StatusBar();
      status.start("first");
      status.start("second");
      vi.advanceTimersByTime(100);
      status.stop();
      expect(output.join("")).toContain("second");
      expect(output.join("")).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    } finally {
      process.stdout.write = originalWrite;
      restoreTty();
    }
  });
});

function setTty(stream: NodeJS.WriteStream, value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, "isTTY");
  Object.defineProperty(stream, "isTTY", {
    configurable: true,
    value,
  });
  return () => {
    if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
    else delete (stream as { isTTY?: boolean }).isTTY;
  };
}
