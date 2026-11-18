import { describe, expect, it } from "../../../scripts/testing/support.mjs";
import { estimateTokenCount, truncateTextToTokenBudget } from "./tokens.js";

describe("estimateTokenCount", () => {
  it("uses a code-friendly estimate for ASCII text", () => {
    expect(estimateTokenCount("a".repeat(32))).toBe(10);
  });

  it("does not underestimate dense CJK conversations", () => {
    expect(estimateTokenCount("请全面检查并继续完善上下文压缩功能")).toBe(17);
  });

  it("handles mixed-language prompts conservatively", () => {
    expect(estimateTokenCount("fix登录页面token预算")).toBe(9);
  });

  it("truncates while retaining useful text from both ends", () => {
    const result = truncateTextToTokenBudget(
      `BEGIN-${"中".repeat(200)}-END`,
      40,
    );
    expect(estimateTokenCount(result)).toBeLessThanOrEqual(40);
    expect(result).toContain("BEGIN");
    expect(result).toContain("END");
    expect(result).toContain("truncated");
  });
});
