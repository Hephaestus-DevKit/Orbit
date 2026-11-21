import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { verificationSummary } from "./WebUiClientReview.js";

describe("task result links", () => {
  const en = (label: string) => label;
  it("reports a failure even when another saved check lacks its outcome", () => {
    expect(verificationSummary([{ timestamp: "" }, { timestamp: "", success: false }], en)).toBe(
      "1 failed",
    );
  });
  it("only reports success for known successful checks", () => {
    expect(verificationSummary([], en)).toBe("See records");
    expect(verificationSummary([{ timestamp: "", success: true }, { timestamp: "" }], en)).toBe(
      "See records",
    );
    expect(verificationSummary([{ timestamp: "", success: true }], en)).toBe("1 passed");
  });
});
