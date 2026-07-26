import { describe, expect, it } from "vitest";
import {
  getOrbitLanguageTag,
  localizeOrbit,
  parseOrbitLanguage,
} from "./language.js";

describe("Orbit language helpers", () => {
  it("normalizes supported language aliases", () => {
    expect(parseOrbitLanguage("English")).toBe("en");
    expect(parseOrbitLanguage("zh-CN")).toBe("zh");
    expect(parseOrbitLanguage("简体中文")).toBe("zh");
    expect(parseOrbitLanguage("zh-Hant")).toBe("zh-TW");
    expect(parseOrbitLanguage("繁體中文")).toBe("zh-TW");
    expect(parseOrbitLanguage("unknown")).toBeUndefined();
  });

  it("uses standards-based browser language tags and explicit copy", () => {
    expect(getOrbitLanguageTag("zh")).toBe("zh-CN");
    expect(getOrbitLanguageTag("zh-TW")).toBe("zh-TW");
    expect(localizeOrbit("zh-TW", "A", "甲", "乙")).toBe("乙");
  });
});
