import { describe, expect, it } from "vitest";
import {
  processOutputLimitExceeded,
  readProcessFailureMessage,
  safeProcessFailureMessage,
} from "./processLimits.js";

describe("process failure summaries", () => {
  it("removes multiline noise and bounds generic failures", () => {
    const summary = safeProcessFailureMessage(`first\n${"x".repeat(3_000)}`);
    expect(summary).not.toContain("\n");
    expect(summary.length).toBe(2_000);
  });

  it("does not expose an inline macOS Seatbelt profile or host paths", () => {
    const summary = readProcessFailureMessage(
      {
        shortMessage:
          'Command was killed with SIGABRT: /usr/bin/sandbox-exec -p (deny default) (allow file-read* (subpath "/Users/private/workspace")) /bin/bash',
      },
      { sandboxBackend: "macos-sandbox-exec" },
    );

    expect(summary).toBe(
      "The macOS sandboxed process was terminated by SIGABRT.",
    );
    expect(summary).not.toContain("/Users/private");
    expect(summary).not.toContain("deny default");
  });

  it("detects explicit and message-based output limits", () => {
    expect(processOutputLimitExceeded({ isMaxBuffer: true })).toBe(true);
    expect(
      processOutputLimitExceeded({ shortMessage: "maxBuffer exceeded" }),
    ).toBe(true);
    expect(processOutputLimitExceeded({ shortMessage: "exit 1" })).toBe(false);
  });
});
