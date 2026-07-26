import { describe, expect, it } from "vitest";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "./childProcess.js";

describe("hidden child process options", () => {
  it("keeps spawned console windows hidden", () => {
    expect(HIDDEN_CHILD_PROCESS_OPTIONS).toEqual({ windowsHide: true });
    expect(Object.isFrozen(HIDDEN_CHILD_PROCESS_OPTIONS)).toBe(true);
  });
});
