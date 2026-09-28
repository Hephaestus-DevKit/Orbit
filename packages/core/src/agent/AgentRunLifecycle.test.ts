import { describe, expect, it } from "vitest";
import { AgentRunLifecycle } from "./AgentRunLifecycle.js";

const context = "session";
describe("agent run lifecycle", () => {
  it("rejects overlapping starts and releases ownership after failure", async () => {
    const lifecycle = new AgentRunLifecycle();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = lifecycle.run(context, () => gate);
    await expect(lifecycle.run(context, async () => undefined)).rejects.toThrow(
      "active run",
    );
    release();
    await first;
    await expect(
      lifecycle.run(context, async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(lifecycle.run(context, async () => "next")).resolves.toBe(
      "next",
    );
  });
  it("cancels hooks before a model step exists and gives the next run a fresh signal", async () => {
    const lifecycle = new AgentRunLifecycle();
    await lifecycle.run(context, async () => {
      const signal = lifecycle.signalFor();
      lifecycle.abort();
      expect(signal?.aborted).toBe(true);
    });
    expect(lifecycle.signalFor()).toBeUndefined();
    await lifecycle.run(context, async () => {
      expect(lifecycle.signalFor()?.aborted).toBe(false);
      const step = new AbortController();
      const combined = lifecycle.signalFor(step.signal);
      step.abort();
      expect(combined?.aborted).toBe(true);
    });
  });
});
