import { describe, expect, it } from "vitest";
import { redactBrowserSnapshot } from "./BrowserSnapshotRedaction.js";

describe("redactBrowserSnapshot", () => {
  it("hides arbitrary password and draft values without relying on secret patterns", () => {
    expect(
      redactBrowserSnapshot(
        '- heading "Account" [level=1]\n- textbox "Password": fixture-private-password-9f2b\n- textbox "Search": draft words\n- paragraph: Public page text',
      ),
    ).toBe(
      '- heading "Account" [level=1]\n- textbox [form value hidden]\n- textbox [form value hidden]\n- paragraph: Public page text',
    );
  });

  it("removes nested editable content but preserves sibling controls", () => {
    expect(
      redactBrowserSnapshot(
        '- generic:\n  - searchbox "Query":\n\n    - text: private draft\n  - button "Submit"\n- paragraph: Visible result',
      ),
    ).toBe(
      '- generic:\n  - searchbox [form value hidden]\n  - button "Submit"\n- paragraph: Visible result',
    );
  });
});
