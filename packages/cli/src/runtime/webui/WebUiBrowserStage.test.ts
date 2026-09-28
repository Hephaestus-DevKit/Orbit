import { describe, expect, it } from "vitest";
import { browserStageMode } from "./WebUiBrowserStage.js";

const baseline = {
  active: false,
  loading: false,
  pending: false,
  closing: false,
  hasImage: false,
  disconnected: false,
  failed: false,
  idleNotice: false,
};

describe("browserStageMode", () => {
  it("uses an explicit first-frame fallback only when the canvas has no image", () => {
    expect(browserStageMode(baseline)).toBe("idle");
    expect(browserStageMode({ ...baseline, pending: true })).toBe("opening");
    expect(browserStageMode({ ...baseline, active: true, loading: true })).toBe(
      "opening",
    );
    expect(browserStageMode({ ...baseline, active: true })).toBe("waiting");
    expect(
      browserStageMode({
        ...baseline,
        active: true,
        pending: true,
        closing: true,
      }),
    ).toBe("closing");
    expect(
      browserStageMode({ ...baseline, active: true, hasImage: true }),
    ).toBe("hidden");
  });

  it("prioritizes reconnection and failure but preserves the last frame", () => {
    expect(browserStageMode({ ...baseline, disconnected: true })).toBe(
      "disconnected",
    );
    expect(
      browserStageMode({ ...baseline, disconnected: true, pending: true }),
    ).toBe("disconnected");
    expect(
      browserStageMode({ ...baseline, disconnected: true, closing: true }),
    ).toBe("closing");
    expect(browserStageMode({ ...baseline, failed: true })).toBe("error");
    expect(
      browserStageMode({ ...baseline, disconnected: true, hasImage: true }),
    ).toBe("hidden");
    expect(
      browserStageMode({ ...baseline, failed: true, idleNotice: true }),
    ).toBe("hidden");
  });
});
