import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { resolveBrowserAddress } from "./WebUiClientBrowser.js";

describe("addresses entered in the Safari panel", () => {
  const orbit = "http://127.0.0.1:8199";
  it.each([
    ["example.com/docs", "https://example.com/docs"],
    ["Example.com:8443/test?q=hello#notes", "https://example.com:8443/test?q=hello#notes"],
    ["localhost:5173", "http://localhost:5173/"],
    ["http://127.0.0.1:5000/view", "http://localhost:5000/view"],
  ])("normalizes %s", (input, address) => {
    expect(resolveBrowserAddress(input, orbit)).toEqual({ url: new URL(address) });
  });
  it.each([
    "",
    "data:text/plain,hi",
    "about:blank",
    "javascript:void(0)",
    "file:///tmp/a",
    "/relative",
    "//example.com",
    "http://example.com",
    "https:///example.com",
    "https://example.com/a b",
    "https://abc@example.com/",
    "https://example.com/#token=foo",
    "https://a\\b.com",
    orbit,
    "http://localhost:8199/other",
    "hello",
  ])("rejects unusable or sensitive address %s", input => {
    expect(resolveBrowserAddress(input, orbit)).toHaveProperty("error");
  });
  it("rejects addresses exceeding the input limit", () => {
    expect(resolveBrowserAddress("https://example.com/" + "x".repeat(8193), orbit)).toEqual({
      error: "invalid",
    });
  });
  it("keeps local frames off the workspace cookie host even on other ports", () => {
    expect(resolveBrowserAddress("localhost:3000", "http://localhost:8199")).toEqual({
      error: "local",
    });
  });
});
