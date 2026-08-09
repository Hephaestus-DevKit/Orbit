import { describe, expect, it } from "vitest";
import { sanitizeExternalErrorMessage } from "./externalError.js";

describe("sanitizeExternalErrorMessage", () => {
  it("redacts credentials and removes terminal controls", () => {
    expect(
      sanitizeExternalErrorMessage(
        new Error("\u001b[31mBearer private-token\u001b[0m\u0000\tfailed"),
      ),
    ).toBe("Bearer ***REDACTED*** failed");
  });

  it("can produce bounded single-line output", () => {
    expect(
      sanitizeExternalErrorMessage(" first\r\nsecond ", {
        maxLength: 12,
        singleLine: true,
      }),
    ).toBe("first second");
  });

  it("rejects invalid output bounds", () => {
    expect(() =>
      sanitizeExternalErrorMessage("failure", { maxLength: 0 }),
    ).toThrow("positive integer");
  });
});
