import { describe, expect, it } from "vitest";
import { HIGH_CONTRAST, MORANDI, PLAIN, resolveTuiTheme } from "./TuiTheme.js";

describe("TuiTheme", () => {
  it("provides an explicit text-only theme", () => {
    expect(resolveTuiTheme("never")).toBe(PLAIN);
    expect(PLAIN.accent("status")).toBe("status");
    expect(PLAIN.userBold("prompt")).toBe("prompt");
  });

  it("resolves persisted named themes without weakening color controls", () => {
    expect(resolveTuiTheme("always", {}, "high-contrast")).toBe(HIGH_CONTRAST);
    expect(resolveTuiTheme("auto", {}, "high-contrast")).toBe(HIGH_CONTRAST);
    expect(resolveTuiTheme("always", {}, "plain")).toBe(PLAIN);
    expect(resolveTuiTheme("never", {}, "high-contrast")).toBe(PLAIN);
    expect(MORANDI).not.toBe(HIGH_CONTRAST);
  });

  it("allows explicit color to override terminal environment hints", () => {
    expect(resolveTuiTheme("always", { NO_COLOR: "1", TERM: "dumb" })).toBe(
      MORANDI,
    );
    expect(resolveTuiTheme("never", { FORCE_COLOR: "1" })).toBe(PLAIN);
  });

  it("follows NO_COLOR and dumb terminals in auto mode", () => {
    expect(resolveTuiTheme("auto", { NO_COLOR: "" })).toBe(PLAIN);
    expect(resolveTuiTheme("auto", { TERM: "dumb" })).toBe(PLAIN);
    expect(resolveTuiTheme("auto", {})).toBe(MORANDI);
  });

  it("honors FORCE_COLOR unless explicitly disabled", () => {
    expect(resolveTuiTheme("auto", { FORCE_COLOR: "1", TERM: "dumb" })).toBe(
      MORANDI,
    );
    expect(resolveTuiTheme("auto", { FORCE_COLOR: "0" })).toBe(MORANDI);
  });
});
