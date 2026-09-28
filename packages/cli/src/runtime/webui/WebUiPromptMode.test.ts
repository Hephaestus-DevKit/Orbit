import { describe, expect, it } from "vitest";
import { resolveWebUiPromptMode } from "./WebUiPromptMode.js";

describe("WebUI prompt mode preflight", () => {
  it("rejects browser and image attachments in multi-agent mode", () => {
    expect(
      resolveWebUiPromptMode("multi", false, false, true, 0, "Inspect").error,
    ).toContain("single-agent");
    expect(
      resolveWebUiPromptMode("multi", false, false, false, 1, "Inspect").error,
    ).toContain("Image attachments");
  });
  it("allows attachments for supported single-agent turns", () => {
    expect(
      resolveWebUiPromptMode("single", false, false, true, 1, "Inspect"),
    ).toEqual({
      useMulti: false,
    });
    expect(
      resolveWebUiPromptMode("default", true, false, false, 0, "Inspect"),
    ).toEqual({
      useMulti: true,
    });
  });
  it("rejects empty prompts and browser-bound commands before running", () => {
    expect(
      resolveWebUiPromptMode("single", false, false, false, 0, "").error,
    ).toBe("Prompt is empty.");
    expect(
      resolveWebUiPromptMode("single", false, false, true, 0, "/help").error,
    ).toContain("direct Agent questions only");
  });
});
