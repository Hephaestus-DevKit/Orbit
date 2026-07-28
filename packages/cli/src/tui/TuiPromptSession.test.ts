import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import {
  createPromptState,
  reducePromptKeypress,
  TuiPromptSession,
} from "./TuiPromptSession.js";

class FakeStdin extends EventEmitter {
  public isRaw = false;
  public readonly resume = vi.fn();
  public readonly pause = vi.fn();
  public readonly setRawMode = vi.fn((enabled: boolean) => {
    this.isRaw = enabled;
    return this;
  });
}

describe("TuiPromptSession", () => {
  it("filters list options and keeps selection visible", () => {
    const state = createPromptState({
      type: "select",
      message: "Choose",
      options: [
        { value: "alpha", label: "Alpha" },
        { value: "beta", label: "Beta" },
      ],
    });
    reducePromptKeypress(state, "/", { name: "/" });
    reducePromptKeypress(state, "b", { name: "b" });
    expect(state.filterActive).toBe(true);
    expect(state.filterQuery).toBe("b");
    expect(state.selectedIndex).toBe(1);
  });

  it("requires a deliberate second delete keypress", () => {
    const state = createPromptState({
      type: "select",
      message: "Delete",
      deletable: true,
      options: [{ value: "session-1", label: "Session" }],
    });
    expect(reducePromptKeypress(state, "", { name: "delete" })).toEqual({
      kind: "render",
    });
    expect(reducePromptKeypress(state, "", { name: "delete" })).toEqual({
      kind: "complete",
      value: { action: "delete", value: "session-1" },
    });
  });

  it("edits Unicode text by code point", () => {
    const state = createPromptState({
      type: "text",
      message: "Input",
      initialValue: "A😀B",
    });
    reducePromptKeypress(state, "", { name: "left" });
    reducePromptKeypress(state, "", { name: "backspace" });
    expect(state.inputValue).toBe("AB");
    expect(state.cursorPosition).toBe(1);
  });

  it("owns and restores its key listener and raw mode", async () => {
    const stdin = new FakeStdin();
    const render = vi.fn();
    const session = new TuiPromptSession(
      render,
      stdin as unknown as NodeJS.ReadStream,
    );
    const result = session.show({ type: "confirm", message: "Continue?" });
    expect(stdin.listenerCount("keypress")).toBe(1);
    expect(stdin.isRaw).toBe(true);

    stdin.emit("keypress", "", { name: "enter" });
    await expect(result).resolves.toBe(true);
    expect(stdin.listenerCount("keypress")).toBe(0);
    expect(stdin.isRaw).toBe(false);
    expect(stdin.pause).toHaveBeenCalledOnce();
  });

  it("hands a successful selection to the next prompt without a base render", async () => {
    const stdin = new FakeStdin();
    const render = vi.fn();
    const session = new TuiPromptSession(
      render,
      stdin as unknown as NodeJS.ReadStream,
    );
    const result = session.show({
      type: "select",
      message: "Provider",
      options: [{ value: "provider-b", label: "Provider B" }],
      suppressCloseRenderOnSelect: true,
    });
    render.mockClear();

    stdin.emit("keypress", "", { name: "enter" });

    await expect(result).resolves.toBe("provider-b");
    expect(render).not.toHaveBeenCalled();
  });

  it("restores terminal input across consecutive selection prompts", async () => {
    const stdin = new FakeStdin();
    const session = new TuiPromptSession(
      vi.fn(),
      stdin as unknown as NodeJS.ReadStream,
    );

    const provider = session.show({
      type: "select",
      message: "Provider",
      options: [{ value: "provider-a", label: "Provider A" }],
    });
    stdin.emit("keypress", "", { name: "enter" });
    await expect(provider).resolves.toBe("provider-a");

    const model = session.show({
      type: "select",
      message: "Model",
      options: [{ value: "model-a", label: "Model A" }],
    });
    stdin.emit("keypress", "", { name: "enter" });
    await expect(model).resolves.toBe("model-a");

    expect(stdin.resume).toHaveBeenCalledTimes(2);
    expect(stdin.pause).toHaveBeenCalledTimes(2);
    expect(stdin.listenerCount("keypress")).toBe(0);
    expect(stdin.isRaw).toBe(false);
  });
});
