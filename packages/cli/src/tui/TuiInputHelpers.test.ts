import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import {
  filterPromptOptionIndices,
  findPreviousHistoryEntry,
  nextCodePointIndex,
  previousCodePointIndex,
  rankSlashCandidates,
} from "./TuiInputHelpers.js";

describe("TuiInputHelpers", () => {
  it("moves across surrogate pairs without splitting them", () => {
    expect(nextCodePointIndex("A🙂B", 1)).toBe(3);
    expect(previousCodePointIndex("A🙂B", 3)).toBe(1);
  });

  it("filters prompt options and ranks slash commands", () => {
    expect(
      filterPromptOptionIndices(
        [
          { value: "flash", label: "DeepSeek Flash" },
          { value: "pro", label: "DeepSeek Pro" },
        ],
        "pro",
      ),
    ).toEqual([1]);
    expect(rankSlashCandidates(["/model", "/mode"], "/mod")[0]).toBe("/model");
  });

  it("searches command history from the requested position", () => {
    expect(findPreviousHistoryEntry(["one", "two"], "o", 2)).toEqual({
      entry: "two",
      index: 1,
    });
  });
});
