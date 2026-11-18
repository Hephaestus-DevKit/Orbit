import { describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";
import { deriveSessionTitle, ensureSessionTitle } from "./SessionTitles.js";

describe("SessionTitles", () => {
  it("creates compact English and CJK titles locally", () => {
    expect(
      deriveSessionTitle(
        "Review this entire repository and fix every high impact issue safely",
      ),
    ).toBe("Review this entire repository and fix every high");
    expect(
      deriveSessionTitle(
        "全面审查这个项目，找出影响最大的问题并完成修复。然后运行测试",
      ),
    ).toBe("全面审查这个项目，找出影响最大的问题并完成修复");
  });

  it("removes markup, control characters, and visible secrets", () => {
    expect(
      deriveSessionTitle("# Fix Bearer private-secret-value\u0000 immediately"),
    ).toBe("Fix Bearer ***REDACTED*** immediately");
  });

  it("updates only an untitled active session", () => {
    const updateSession = vi.fn();
    const activeSession = {
      id: "sess-calm-fox-001",
      title: "New Orbit Session",
    };
    const loop = {
      sessionManager: {
        getActiveSession: () => activeSession,
        getSessionStore: () => ({ updateSession }),
      },
    };

    expect(ensureSessionTitle(loop as never, "Fix the Web UI layout")).toBe(
      "Fix the Web UI layout",
    );
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Fix the Web UI layout" }),
    );
    expect(
      ensureSessionTitle(loop as never, "A different task"),
    ).toBeUndefined();
    expect(updateSession).toHaveBeenCalledTimes(1);
  });
});
