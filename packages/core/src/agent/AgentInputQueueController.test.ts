import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "@orbit-build/session";
import { eventBus } from "../events/EventBus.js";
import { AgentInputQueueController } from "./AgentInputQueueController.js";

const workspaces: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("AgentInputQueueController", () => {
  it("owns durable mutations and emits content-free lifecycle events", () => {
    const sessions = createSessions();
    const controller = new AgentInputQueueController(sessions);
    const emit = vi.spyOn(eventBus, "emitEvent");

    const first = controller.enqueue("first secret instruction", {
      mode: "follow_up",
      source: "terminal",
    });
    const second = controller.enqueue("second secret instruction", {
      mode: "follow_up",
      source: "web",
    });
    controller.update(second.id, { text: "updated secret instruction" });
    expect(controller.move(second.id, "up")).toBe(true);
    expect(controller.takeNext()?.id).toBe(second.id);
    expect(controller.remove(first.id)).toBe(true);

    expect(controller.list()).toEqual([]);
    const serializedEvents = JSON.stringify(
      emit.mock.calls.map(([type, payload]) => ({ type, payload })),
    );
    expect(serializedEvents).not.toContain("secret instruction");
    expect(emit).toHaveBeenCalledWith(
      "agent_input_moved",
      expect.objectContaining({
        inputId: second.id,
        fromIndex: 1,
        toIndex: 0,
      }),
    );
  });

  it("drains only steering while preserving ordered follow-ups", () => {
    const controller = new AgentInputQueueController(createSessions());
    controller.enqueue("follow up", {
      mode: "follow_up",
      source: "terminal",
    });
    const steer = controller.enqueue("steer now", {
      mode: "steer",
      source: "web",
    });

    expect(controller.drainSteering().map((item) => item.id)).toEqual([
      steer.id,
    ]);
    expect(controller.list().map((item) => item.text)).toEqual(["follow up"]);
  });
});

function createSessions(): SessionManager {
  const cwd = mkdtempSync(path.join(tmpdir(), "orbit-input-controller-"));
  workspaces.push(cwd);
  const sessions = new SessionManager(cwd);
  sessions.startNewSession("test-provider", "test-model");
  return sessions;
}
