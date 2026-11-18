import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { PLAIN } from "./TuiTheme.js";
import { formatSystemLinesForDisplay } from "./TuiSystemStatusView.js";
describe("terminal system status view", () => {
  it("condenses lookup bursts and keeps the following failure visible", () => {
    const lines = formatSystemLinesForDisplay(
      PLAIN,
      [
        {
          role: "system",
          text:
            "✦ web_search first\n✔ Success: Web search returned 3 results\n✦ web_search second\n✖ verification failed",
        },
      ],
      { prefixUnknown: false, preserveBlank: false },
    );
    expect(lines).toEqual([
      "✦ web_search 2 searches · 3 results · latest: second",
      "failed verification failed",
    ]);
  });
  it("renders a completed action link once without dropping blank paragraphs", () => {
    const lines = formatSystemLinesForDisplay(
      PLAIN,
      [
        {
          role: "system",
          text: "✔ Ready\n\nDetails",
          actionLink: { label: "Open", url: "http://localhost:1234/" },
        },
      ],
      { prefixUnknown: false, preserveBlank: true },
    );
    expect(lines[0]).toContain("Open");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("Details");
  });
});
