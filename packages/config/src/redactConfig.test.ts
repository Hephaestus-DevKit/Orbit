import { describe, expect, it } from "../../../scripts/testing/support.mjs";
import { redactConfigForDisplay } from "./redactConfig.js";

describe("redactConfigForDisplay", () => {
  it("redacts credentials without hiding provider names containing token", () => {
    expect(
      redactConfigForDisplay({
        providers: {
          tokendance: {
            baseUrl: "https://tokendance.space/gateway/v1",
            apiKey: "private-key",
            authToken: "private-token",
          },
        },
      }),
    ).toEqual({
      providers: {
        tokendance: {
          baseUrl: "https://tokendance.space/gateway/v1",
          apiKey: "[REDACTED]",
          authToken: "[REDACTED]",
        },
      },
    });
  });
});
