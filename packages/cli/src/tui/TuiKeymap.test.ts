import { describe, expect, it } from "vitest";
import { getVimModeLabel, resolveVimNormalCommand } from "./TuiKeymap.js";

describe("TuiKeymap", () => {
  it("maps navigation and editing keys to semantic Vim commands", () => {
    expect(resolveVimNormalCommand("h")).toBe("left");
    expect(resolveVimNormalCommand("l")).toBe("right");
    expect(resolveVimNormalCommand("b")).toBe("backward-word");
    expect(resolveVimNormalCommand("w")).toBe("forward-word");
    expect(resolveVimNormalCommand("0")).toBe("start");
    expect(resolveVimNormalCommand("$")).toBe("end");
    expect(resolveVimNormalCommand("x")).toBe("delete-char");
    expect(resolveVimNormalCommand("d")).toBe("delete-operator");
    expect(resolveVimNormalCommand("c")).toBe("change-operator");
    expect(resolveVimNormalCommand("D")).toBe("delete-to-end");
    expect(resolveVimNormalCommand("C")).toBe("change-to-end");
    expect(resolveVimNormalCommand("u")).toBe("undo");
  });

  it("maps mode changes and submission without treating unknown input as text", () => {
    expect(resolveVimNormalCommand("i")).toBe("insert");
    expect(resolveVimNormalCommand("a")).toBe("append");
    expect(resolveVimNormalCommand("I")).toBe("insert-start");
    expect(resolveVimNormalCommand("A")).toBe("append-end");
    expect(resolveVimNormalCommand("", { name: "enter" })).toBe("submit");
    expect(resolveVimNormalCommand("q")).toBeNull();
  });

  it("localizes the compact mode label", () => {
    expect(getVimModeLabel("normal", false)).toBe("NORMAL");
    expect(getVimModeLabel("insert", true)).toBe("插入模式");
  });
});
