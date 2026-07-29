import { describe, expect, it, vi } from "vitest";
import { AgentTaskScheduler } from "./AgentTaskScheduler.js";

describe("AgentTaskScheduler", () => {
  it("runs independent read tasks concurrently and waits for dependencies", async () => {
    let active = 0;
    let maxActive = 0;
    const review = async (name: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return name;
    };
    const final = vi.fn(async () => "done");
    const results = await new AgentTaskScheduler({ maxConcurrency: 2 }).run([
      { id: "correctness", run: () => review("correctness") },
      { id: "security", run: () => review("security") },
      {
        id: "summary",
        dependsOn: ["correctness", "security"],
        run: final,
      },
    ]);

    expect(maxActive).toBe(2);
    expect(final).toHaveBeenCalledOnce();
    expect(results.map((result) => result.status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
  });

  it("serializes overlapping writers while allowing disjoint ownership", async () => {
    let workspaceWriters = 0;
    let overlappingWriters = 0;
    const runWriter = async (workspace: boolean) => {
      if (workspace) {
        workspaceWriters++;
        overlappingWriters = Math.max(overlappingWriters, workspaceWriters);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (workspace) workspaceWriters--;
      return true;
    };
    const results = await new AgentTaskScheduler({ maxConcurrency: 3 }).run([
      {
        id: "writer-a",
        access: { mode: "write", scopes: ["workspace"] },
        run: () => runWriter(true),
      },
      {
        id: "writer-b",
        access: { mode: "write", scopes: ["workspace"] },
        run: () => runWriter(true),
      },
      {
        id: "writer-docs",
        access: { mode: "write", scopes: ["docs"] },
        run: () => runWriter(false),
      },
    ]);

    expect(overlappingWriters).toBe(1);
    expect(results.every((result) => result.status === "completed")).toBe(true);
  });

  it("treats nested and Windows-style ownership scopes as overlapping", async () => {
    let active = 0;
    let maxActive = 0;
    const write = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return true;
    };
    const results = await new AgentTaskScheduler({ maxConcurrency: 2 }).run([
      {
        id: "src",
        access: { mode: "write", scopes: ["src"] },
        run: write,
      },
      {
        id: "nested",
        access: { mode: "write", scopes: [".\\src\\core"] },
        run: write,
      },
    ]);

    expect(maxActive).toBe(1);
    expect(results.every((result) => result.status === "completed")).toBe(true);
  });

  it("blocks dependents after failure and rejects dependency cycles", async () => {
    const dependent = vi.fn(async () => true);
    const results = await new AgentTaskScheduler().run([
      {
        id: "failed",
        run: async () => {
          throw new Error("failed");
        },
      },
      { id: "dependent", dependsOn: ["failed"], run: dependent },
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "failed",
      "blocked",
    ]);
    expect(dependent).not.toHaveBeenCalled();

    const cycle = await new AgentTaskScheduler().run([
      { id: "a", dependsOn: ["b"], run: async () => true },
      { id: "b", dependsOn: ["a"], run: async () => true },
    ]);
    expect(cycle.every((result) => result.status === "blocked")).toBe(true);
  });

  it("propagates cancellation to active and pending tasks", async () => {
    const scheduler = new AgentTaskScheduler({ maxConcurrency: 1 });
    const run = scheduler.run([
      {
        id: "active",
        run: (signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          ),
      },
      { id: "pending", run: async () => true },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    scheduler.abort("cancelled by user");
    const results = await run;

    expect(results.map((result) => result.status)).toEqual([
      "aborted",
      "aborted",
    ]);
  });

  it("cancels the graph after a timeout and cannot be reused", async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new AgentTaskScheduler({
        maxConcurrency: 1,
        abortGraceMs: 100,
      });
      const pending = vi.fn(async () => true);
      const run = scheduler.run([
        {
          id: "timeout",
          timeoutMs: 1_000,
          run: (signal) =>
            new Promise((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              }),
            ),
        },
        { id: "pending", run: pending },
      ]);

      await vi.advanceTimersByTimeAsync(1_000);
      const results = await run;
      expect(results.map((result) => result.status)).toEqual([
        "failed",
        "aborted",
      ]);
      expect(pending).not.toHaveBeenCalled();
      await expect(scheduler.run([])).rejects.toThrow("can only run once");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
