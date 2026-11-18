import { describe, expect, it } from "../../../../../scripts/testing/support.mjs";
import {
  renderModelSelectOptions,
  renderProviderSelectOptions,
} from "./WebUiModelSelectOptions.js";

function mockSelect() {
  const options: Array<{
    value: string;
    textContent: string;
    disabled: boolean;
    title: string;
    dataset: Record<string, string>;
  }> = [];
  const element = {
    value: "",
    ownerDocument: {
      createElement: () => ({
        value: "",
        textContent: "",
        disabled: false,
        title: "",
        dataset: {},
      }),
    },
    replaceChildren: () => options.splice(0),
    append: (option: (typeof options)[number]) => options.push(option),
  };
  return { select: element as unknown as HTMLSelectElement, options };
}

describe("model selection presentation", () => {
  const modelOptions = [
    { id: "__auto__", label: "Auto · deepseek-flash / deepseek-v4-pro" },
    { id: "deepseek-flash", label: "deepseek-flash" },
  ];

  it.each([
    ["en", "Automatic"],
    ["zh", "自动选择"],
    ["zh-TW", "自動選擇"],
  ] as const)(
    "preserves the full menu and selection in %s",
    (language, label) => {
      const composer = mockSelect();
      const settings = mockSelect();
      renderModelSelectOptions(
        [composer.select, settings.select],
        { modelSelection: "__auto__", modelOptions },
        language,
      );
      for (const { select, options } of [composer, settings]) {
        expect(select.value).toBe("__auto__");
        expect(options[0]).toMatchObject({
          textContent: modelOptions[0]!.label,
          dataset: { displayLabel: label },
          disabled: false,
        });
        expect(options[1]!.dataset).toEqual({});
      }
    },
  );

  it("keeps a stale selected model disabled and removes it after recovery", () => {
    const { select, options } = mockSelect();
    renderModelSelectOptions(
      [select],
      { activeModel: "retired-model", modelOptions },
      "en",
    );
    expect(select.value).toBe("retired-model");
    expect(options[0]).toMatchObject({
      value: "retired-model",
      textContent: "Select a supported model",
      disabled: true,
    });
    renderModelSelectOptions(
      [select],
      { modelSelection: "deepseek-flash", modelOptions },
      "en",
    );
    expect(select.value).toBe("deepseek-flash");
    expect(options.map((option) => option.value)).toEqual([
      "__auto__",
      "deepseek-flash",
    ]);
  });

  it("renders untrusted provider labels as text and replaces old providers", () => {
    const { select, options } = mockSelect();
    const label = '<img src=x onerror="alert(1)">';
    renderProviderSelectOptions(select, {
      id: "custom",
      options: [{ id: "custom", label, modelCount: 2 }],
    });
    expect(select.value).toBe("custom");
    expect(options[0]).toMatchObject({
      textContent: label + " · 2",
      dataset: { displayLabel: label },
      title: "custom",
    });
    renderProviderSelectOptions(select);
    expect(options).toEqual([]);
    expect(select.value).toBe("");
  });
});
