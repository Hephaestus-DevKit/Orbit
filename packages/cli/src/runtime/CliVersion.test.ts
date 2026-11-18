import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { readCliVersion, RUNNING_CLI_VERSION } from "./CliVersion.js";

describe("CliVersion", () => {
  it("exposes one immutable version snapshot for the running process", () => {
    expect(readCliVersion()).toBe(RUNNING_CLI_VERSION);
    expect(readCliVersion()).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });
});
