import { describe, expect, it } from "vitest";
import {
  BrowserPreviewRequestSchema,
  isPreviewRequestAllowed,
  parsePreviewUrl,
} from "./BrowserPreviewPolicy.js";

describe("local browser preview policy", () => {
  it("pins localhost to the loopback address", () => {
    expect(parsePreviewUrl("http://localhost:5173/app", 6047).href).toBe(
      "http://127.0.0.1:5173/app",
    );
  });
  it.each([
    "https://localhost:5173",
    "http://localhost",
    "http://127.0.0.1:80",
    "http://127.0.0.1:6047",
    "http://192.168.1.1:5173",
    "http://169.254.169.254:5173",
    "http://example.com:5173",
    "http://localhost.evil.test:5173",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://name:secret@127.0.0.1:5173",
    "http://127.0.0.1:5173?token=secret",
    "http://127.0.0.1:5173/#token=secret",
  ])("rejects unauthorized preview target %s", (input) => {
    expect(() => parsePreviewUrl(input, 6047)).toThrow();
  });
  it.each([
    "http://127.0.0.1:5174/api",
    "http://localhost:5173/api",
    "http://127.0.0.1:5173.evil.test",
    "https://example.com",
    "file:///tmp/test",
    "http://user:pass@127.0.0.1:5173",
  ])("blocks cross-origin or credential-bearing resources", (input) => {
    expect(isPreviewRequestAllowed(input, "http://127.0.0.1:5173")).toBe(false);
  });
  it("permits same-origin resources and HMR sockets only", () => {
    expect(
      isPreviewRequestAllowed(
        "http://127.0.0.1:5173/assets/main.js?v=1",
        "http://127.0.0.1:5173",
      ),
    ).toBe(true);
    expect(
      isPreviewRequestAllowed(
        "ws://127.0.0.1:5173/hmr",
        "http://127.0.0.1:5173",
        true,
      ),
    ).toBe(true);
    expect(
      isPreviewRequestAllowed(
        "ws://127.0.0.1:6047/",
        "http://127.0.0.1:5173",
        true,
      ),
    ).toBe(false);
  });
  it("rejects arbitrary scripts and unknown action parameters", () => {
    expect(
      BrowserPreviewRequestSchema.safeParse({
        action: "evaluate",
        script: "process.exit()",
      }).success,
    ).toBe(false);
    expect(
      BrowserPreviewRequestSchema.safeParse({
        action: "click",
        selector: "button",
        force: true,
      }).success,
    ).toBe(false);
    expect(
      BrowserPreviewRequestSchema.safeParse({
        action: "connect",
        url: "http://localhost:5173",
      }).success,
    ).toBe(true);
  });
});
