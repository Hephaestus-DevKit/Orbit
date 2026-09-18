import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./EventBus.js";

describe("run-owned event delivery", () => {
  it.each([false, true])(
    "closes detached callbacks after settlement (failure=%s)",
    async (fail) => {
      const bus = new EventBus();
      const listener = vi.fn();
      bus.on("model_delta", listener);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let late!: Promise<boolean>;
      const first = bus.runWithRunContext(
        { sessionId: "same", runId: "old" },
        async () => {
          late = gate.then(() => bus.emitEvent("model_delta", { text: "old" }));
          if (fail) throw new Error("failed");
        },
      );
      await first.catch(() => undefined);
      await bus.runWithRunContext(
        { sessionId: "same", runId: "new" },
        async () => {
          release();
          expect(await late).toBe(false);
          bus.emitEvent("model_delta", { text: "new" });
        },
      );
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ text: "new" });
    },
  );

  it("filters concurrent sessions, follows session switches, and cleans up", async () => {
    const bus = new EventBus();
    let session = "main";
    const listener = vi.fn();
    const stop = bus.subscribeSession("model_delta", () => session, listener);
    for (const id of ["child", "main"]) {
      await bus.runWithRunContext({ sessionId: id, runId: id }, async () => {
        bus.emitEvent("model_delta", { text: id });
      });
    }
    session = "child";
    bus.runWithContext({ sessionId: "child", runId: "next" }, () => {
      bus.emitEvent("model_delta", { text: "switched" });
    });
    expect(listener.mock.calls).toEqual([
      [{ text: "main" }],
      [{ text: "switched" }],
    ]);
    stop();
    stop();
    expect(bus.listenerCount("*")).toBe(0);
  });

  it("preserves session-owned background completion after the originating run ends", async () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribeSession("background_task_completed", () => "main", listener);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let late!: Promise<boolean>;
    await bus.runWithRunContext(
      { sessionId: "main", runId: "old" },
      async () => {
        late = gate.then(() =>
          bus.emitEvent("background_task_completed", {
            taskId: "bg_task",
            sessionId: "main",
            command: "test",
            cwd: ".",
            status: "completed",
            startedAt: new Date().toISOString(),
            durationMs: 1,
            exitCode: 0,
            outputTruncated: false,
          }),
        );
      },
    );
    release();
    expect(await late).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
  });
});
