import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { resolveWebUiPromptMode } from "./WebUiPromptMode.js";

describe("WebUI prompt mode preflight", () => {
  it("rejects image attachments in multi-agent mode", () => {
    expect(
      resolveWebUiPromptMode("multi", false, false, 1, "Inspect").error,
    ).toContain("Image attachments");
  });
  it("allows attachments for supported single-agent turns", () => {
    expect(
      resolveWebUiPromptMode("single", false, false, 1, "Inspect"),
    ).toEqual({
      useMulti: false,
    });
    expect(
      resolveWebUiPromptMode("default", true, false, 0, "Inspect"),
    ).toEqual({
      useMulti: true,
    });
  });
  it("rejects empty prompts before running", () => {
    expect(
      resolveWebUiPromptMode("single", false, false, 0, "").error,
    ).toBe("Prompt is empty.");
  });
});
