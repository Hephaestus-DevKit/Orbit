import { describe, expect, it } from "vitest";
import {
  BUILTIN_SLASH_COMMANDS,
  SLASH_COMMAND_DEFINITIONS,
  buildSlashCommandHelp,
} from "./SlashCommandCatalog.js";

const stripAnsi = (value: string): string =>
  value.replace(/\u001b\[[0-9;]*m/g, "");

describe("SlashCommandCatalog", () => {
  it("keeps the Web UI command reserved", () => {
    expect(BUILTIN_SLASH_COMMANDS).toContain("/webui");
    expect(BUILTIN_SLASH_COMMANDS).toContain("/language");
    expect(new Set(BUILTIN_SLASH_COMMANDS).size).toBe(
      BUILTIN_SLASH_COMMANDS.length,
    );
  });

  it("keeps localized discovery metadata complete and unique", () => {
    expect(SLASH_COMMAND_DEFINITIONS.map(({ command }) => command)).toEqual(
      BUILTIN_SLASH_COMMANDS,
    );
    for (const definition of SLASH_COMMAND_DEFINITIONS) {
      expect(definition.description.en.trim()).not.toBe("");
      expect(definition.description.zh.trim()).not.toBe("");
      expect(definition.description["zh-TW"].trim()).not.toBe("");
      expect(typeof definition.webSuggested).toBe("boolean");
      for (const suggestion of definition.suggestions ?? []) {
        expect(suggestion.value).not.toBe("");
        expect(suggestion.description.en.trim()).not.toBe("");
        expect(suggestion.description.zh.trim()).not.toBe("");
        expect(suggestion.description["zh-TW"].trim()).not.toBe("");
      }
    }
  });

  it("renders complete localized help", () => {
    const english = stripAnsi(buildSlashCommandHelp("en"));
    const chinese = stripAnsi(buildSlashCommandHelp("zh"));
    const traditionalChinese = stripAnsi(buildSlashCommandHelp("zh-TW"));

    for (const command of BUILTIN_SLASH_COMMANDS) {
      expect(english).toContain(command);
      expect(chinese).toContain(command);
      expect(traditionalChinese).toContain(command);
    }
    expect(english).toContain("Context Management");
    expect(chinese).toContain("上下文管理");
    expect(traditionalChinese).toContain("上下文管理");
    expect(traditionalChinese).toContain("工作階段與歷史");
    expect(traditionalChinese).toContain("退出互動式終端");
    expect(traditionalChinese).toContain("查看或切換介面語言");
  });
});
