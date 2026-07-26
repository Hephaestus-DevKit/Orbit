import { z } from "zod";

/** Languages supported by Orbit's terminal and local WebUI. */
export const OrbitLanguageSchema = z.enum(["en", "zh", "zh-TW"]);

export type OrbitLanguage = z.infer<typeof OrbitLanguageSchema>;

const LANGUAGE_ALIASES: Record<string, OrbitLanguage> = {
  en: "en",
  english: "en",
  zh: "zh",
  "zh-cn": "zh",
  "zh-hans": "zh",
  简中: "zh",
  简体中文: "zh",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  traditional: "zh-TW",
  繁中: "zh-TW",
  繁體中文: "zh-TW",
  繁体中文: "zh-TW",
};

/** Parse command-line and environment aliases into a canonical Orbit language. */
export function parseOrbitLanguage(value: unknown): OrbitLanguage | undefined {
  if (typeof value !== "string") return undefined;
  return LANGUAGE_ALIASES[value.trim().toLowerCase()];
}

/** Return the language tag used by browsers and Intl formatters. */
export function getOrbitLanguageTag(
  language: OrbitLanguage,
): "en" | "zh-CN" | "zh-TW" {
  if (language === "zh") return "zh-CN";
  return language;
}

/** Select localized copy while keeping Traditional Chinese explicit. */
export function localizeOrbit(
  language: OrbitLanguage,
  english: string,
  simplifiedChinese: string,
  traditionalChinese: string,
): string {
  if (language === "zh-TW") return traditionalChinese;
  return language === "zh" ? simplifiedChinese : english;
}
