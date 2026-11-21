import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import { createConversationDrafts } from "./WebUiClientDrafts.js";

describe("conversation drafts", () => {
  it("migrates a legacy draft once and isolates both workspace and chat", () => {
    const items = new Map([["orbit.webui.draft", "Original"]]);
    const drafts = createConversationDrafts(() => ({
      getItem: key => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
      },
      removeItem: key => {
        items.delete(key);
      },
    }));
    expect(drafts.activate("/a", "chat", "")).toBe("Original");
    expect(items.has("orbit.webui.draft")).toBe(false);
    drafts.save("A");
    expect(drafts.activate("/b", "chat", "A")).toBe("");
    drafts.save("B");
    expect(drafts.activate("/a", "other", "B")).toBe("");
    expect(drafts.activate("/a", "chat", "")).toBe("A");
    expect(drafts.activate("/a", "chat", "editing")).toBeUndefined();
  });

  it("keeps text typed during startup and restores drafts when storage is denied", () => {
    const drafts = createConversationDrafts(() => {
      throw Error("Storage unavailable");
    });
    expect(drafts.activate("/project", "a", "Typing")).toBe("Typing");
    drafts.save("Offline");
    expect(drafts.activate("/project", "b", "Offline")).toBe("");
    expect(drafts.activate("/project", "a", "")).toBe("Offline");
    expect(drafts.recover(drafts.active!, "Failed prompt", "Next thought")).toBe(
      "Failed prompt\n\nNext thought",
    );
    const other = drafts.key("/project", "b");
    drafts.write(other, "Other chat notes");
    expect(drafts.recover(other, "Only in B", "Private in A")).toBeUndefined();
    expect(drafts.read(other)).toBe("Only in B\n\nOther chat notes");
    drafts.save("");
    expect(drafts.read(drafts.key("/project", "a"))).toBe("");
  });
});
