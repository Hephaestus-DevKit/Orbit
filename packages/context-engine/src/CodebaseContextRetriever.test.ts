import { describe, expect, it } from "vitest";
import {
  cleanCodebaseQuery,
  selectCodebaseRetrievalMode,
} from "./CodebaseContextRetriever.js";

describe("CodebaseContextRetriever policy", () => {
  it("automatically retrieves for coding intent in English and Chinese", () => {
    expect(
      selectCodebaseRetrievalMode("Fix the session resume race", true),
    ).toBe("automatic");
    expect(
      selectCodebaseRetrievalMode("检查一下 solver.py 为什么报错", true),
    ).toBe("automatic");
  });

  it("keeps ordinary chat out of repository retrieval", () => {
    expect(selectCodebaseRetrievalMode("你好，今天怎么样？", true)).toBe("off");
    expect(selectCodebaseRetrievalMode("Fix the parser", false)).toBe("off");
  });

  it("supports explicit force and per-turn disable markers", () => {
    expect(selectCodebaseRetrievalMode("@codebase explain flow", false)).toBe(
      "explicit",
    );
    expect(
      selectCodebaseRetrievalMode("@codebase @no-codebase explain flow", true),
    ).toBe("off");
    expect(cleanCodebaseQuery("@codebase inspect @no-codebase parser")).toBe(
      "inspect parser",
    );
  });
});
