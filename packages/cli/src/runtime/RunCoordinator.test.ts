import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { RunCoordinator } from "./RunCoordinator.js";

describe("RunCoordinator", () => {
  it("allows only one terminal or Web owner at a time", () => {
    const coordinator = new RunCoordinator();
    const releaseTerminal = coordinator.acquire("terminal");

    expect(releaseTerminal).toBeTypeOf("function");
    expect(coordinator.isActive()).toBe(true);
    expect(coordinator.isActive("terminal")).toBe(true);
    expect(coordinator.acquire("web")).toBeUndefined();

    releaseTerminal?.();
    const releaseWeb = coordinator.acquire("web");
    expect(releaseWeb).toBeTypeOf("function");
    expect(coordinator.isActive("web")).toBe(true);
  });

  it("makes release callbacks idempotent", () => {
    const coordinator = new RunCoordinator();
    const release = coordinator.acquire("web");

    release?.();
    release?.();

    expect(coordinator.isActive()).toBe(false);
    expect(coordinator.acquire("terminal")).toBeTypeOf("function");
  });
});
