import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { stripAnsiCodes } from "../../tui/TerminalText.js";
import { createWebUiLaunchNotice } from "./WebUiLaunchNotice.js";

describe("createWebUiLaunchNotice", () => {
  it.each([false, true])(
    "redacts the token from visible output and events",
    (isZh) => {
      const token = "a".repeat(43);
      const url = `http://127.0.0.1:6047/#token=${token}`;
      const notice = createWebUiLaunchNotice(url, isZh);
      expect(notice.actionLink.url).toBe(url);
      expect(notice.actionLink.label).toBe("http://127.0.0.1:6047/");
      expect(notice.terminalLine).toContain(`\u001b]8;;${url}\u0007`);
      expect(stripAnsiCodes(notice.terminalLine)).not.toContain(token);
      expect(notice.status).not.toContain(token);
      expect(notice.eventMessage).not.toContain(token);
      expect(notice.eventMessage).toContain(
        isZh ? "Orbit Web UI 已启动" : "Orbit Web UI started",
      );
    },
  );
});
