import { describe, expect, it } from "vitest";
import { daemonRequestError } from "./DaemonRequestError.js";

describe("daemon public errors", () => {
  it.each([
    ["not found /private/project", 404],
    ["already running with credential=hidden", 409],
    ["Unexpected failure at /private/source.ts:100", 400],
  ])("classifies %s without returning internal details", (message, status) => {
    const result = daemonRequestError(new Error(message));
    expect(result.status).toBe(status);
    expect(result.message).not.toMatch(/private|credential|source\.ts/);
  });
});
