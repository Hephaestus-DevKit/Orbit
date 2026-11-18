import type { WebUiLanguage } from "./WebUiPage.js";

interface ModelSelection {
  modelSelection?: string;
  activeModel?: string;
  modelOptions?: ReadonlyArray<{ id: string; label: string }>;
}

interface ProviderSelection {
  id?: string;
  options?: ReadonlyArray<{
    id: string;
    label: string;
    modelCount?: number;
    baseUrl?: string;
  }>;
}

/** Populate model controls with full menu labels and concise selected labels. */
export function renderModelSelectOptions(
  selects: readonly HTMLSelectElement[],
  data: ModelSelection,
  language: WebUiLanguage,
): void {
  const current = data.modelSelection || data.activeModel || "";
  const options = data.modelOptions ?? [];
  for (const select of selects) {
    select.replaceChildren();
    if (!options.some((option) => option.id === current)) {
      const unavailable = select.ownerDocument.createElement("option");
      unavailable.value = current;
      unavailable.textContent = language === "en"
        ? "Select a supported model"
        : language === "zh-TW"
        ? "請選擇受支援的模型"
        : "请选择受支持的模型";
      unavailable.disabled = true;
      select.append(unavailable);
    }
    for (const option of options) {
      const node = select.ownerDocument.createElement("option");
      node.value = option.id;
      node.textContent = option.label;
      if (option.id === "__auto__") {
        node.dataset.displayLabel = language === "en"
          ? "Automatic"
          : language === "zh-TW"
          ? "自動選擇"
          : "自动选择";
      }
      select.append(node);
    }
    select.value = current;
  }
}

/** Keep provider metadata in the menu while the trigger shows its name. */
export function renderProviderSelectOptions(
  select: HTMLSelectElement,
  provider: ProviderSelection = {},
): void {
  select.replaceChildren();
  for (const option of provider.options ?? []) {
    const node = select.ownerDocument.createElement("option");
    node.value = option.id;
    node.textContent = option.label + (option.modelCount ? " · " + option.modelCount : "");
    node.dataset.displayLabel = option.label;
    node.title = option.baseUrl || option.id;
    select.append(node);
  }
  select.value = provider.id || "";
}
