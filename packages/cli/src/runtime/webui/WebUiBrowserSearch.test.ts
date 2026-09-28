import { describe, expect, it } from "vitest";
import { browserSearchQuery } from "./WebUiBrowserSearch.js";

describe("browserSearchQuery", () => {
  it.each([
    "https://www.bing.com/search?q=orbit%20design",
    "https://cn.bing.com/search?q=orbit%20design",
    "https://www.google.com/search?q=orbit%20design",
    "https://www.google.co.uk/search?q=orbit%20design",
    "https://www.baidu.com/s?wd=orbit%20design",
    "https://duckduckgo.com/?q=orbit%20design",
    "https://html.duckduckgo.com/html/?q=orbit%20design",
  ])("recovers a query from a known results page: %s", (url) => {
    expect(browserSearchQuery(url)).toBe("orbit design");
  });

  it.each([
    "https://www.bing.com/account?q=orbit%20design",
    "https://www.google.com/url?q=orbit%20design",
    "https://www.baidu.com/?wd=orbit%20design",
    "https://duckduckgo.com/settings?q=orbit%20design",
    "https://www.bing.com.evil.example/search?q=orbit%20design",
    "https://www.google.evil.example/search?q=orbit%20design",
    "http://www.bing.com/search?q=orbit%20design",
    "https://user@www.bing.com/search?q=orbit%20design",
    "https://www.bing.com:8443/search?q=orbit%20design",
    "https://www.bing.com/search?q=",
    "not a URL",
  ])("does not treat another destination as a search: %s", (url) => {
    expect(browserSearchQuery(url)).toBe("");
  });

  it("rejects queries longer than the omnibox limit", () => {
    expect(
      browserSearchQuery(`https://www.bing.com/search?q=${"x".repeat(4097)}`),
    ).toBe("");
  });
});
