import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { getStringWidth, stripAnsiCodes } from "./TerminalText.js";
import { createPromptState } from "./TuiPromptSession.js";
import { renderPromptScreen } from "./TuiPromptView.js";

describe("TuiPromptView", () => {
  it("renders password values without exposing their plaintext", () => {
    const output = stripAnsiCodes(
      renderPromptScreen(
        createPromptState({
          type: "password",
          message: "Secret",
          initialValue: "private-value",
        }),
        { columns: 80, rows: 24, isZh: false },
      ),
    );
    expect(output).toContain("*".repeat("private-value".length));
    expect(output).not.toContain("private-value");
    expect(output).toContain("Orbit Input");
    expect(output).toContain("°_°");
  });

  it("keeps the cat mascot aligned in a narrow Chinese prompt", () => {
    const columns = 40;
    const output = stripAnsiCodes(
      renderPromptScreen(
        createPromptState({
          type: "select",
          message: "请选择模型",
          options: [
            { value: "flash", label: "DeepSeek Flash" },
            { value: "pro", label: "DeepSeek Pro" },
          ],
        }),
        { columns, rows: 18, isZh: true },
      ),
    );

    expect(output).toContain("Orbit 选择");
    expect(output).toContain("选择");
    expect(output).toContain("/\\ /\\");
    expect(output).toContain("°_°");
    for (const line of output.split("\n")) {
      expect(getStringWidth(line)).toBeLessThanOrEqual(columns);
    }
  });
});
