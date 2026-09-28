import { describe, expect, it } from "vitest";
import { browserFailureMessage } from "./WebUiBrowserFeedback.js";

describe("browser failure copy", () => {
  it("explains timeouts in each supported language", () => {
    expect(
      browserFailureMessage("page.goto: Timeout 20000ms exceeded.", "en"),
    ).toContain("taking too long");
    expect(browserFailureMessage("net::ERR_TIMED_OUT", "zh")).toContain(
      "加载超时",
    );
    expect(browserFailureMessage("timed out", "zh-TW")).toContain("載入逾時");
  });
  it("distinguishes DNS, refused connections, and certificate errors", () => {
    expect(browserFailureMessage("net::ERR_NAME_NOT_RESOLVED", "en")).toContain(
      "spelling",
    );
    expect(
      browserFailureMessage("net::ERR_CONNECTION_REFUSED", "zh"),
    ).toContain("开发服务器");
    expect(
      browserFailureMessage("net::ERR_CERT_AUTHORITY_INVALID", "en"),
    ).toContain("security checks remain enabled");
  });
  it("keeps policy failures intact and omits multiline diagnostics", () => {
    expect(
      browserFailureMessage(
        "Orbit control port is blocked.\nCall log: details",
        "en",
      ),
    ).toBe("Orbit control port is blocked.");
    expect(browserFailureMessage("x".repeat(500), "en")).toHaveLength(350);
  });
});
