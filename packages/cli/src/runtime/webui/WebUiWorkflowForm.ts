import type { WebUiLanguage } from "./WebUiPage.js";

interface WorkflowFormCopy {
  capabilityArgumentHint: string;
  capabilitySkills: string;
  capabilitySkillsHint: string;
  capabilityPreview: string;
}

const STAGE_COPY = {
  en: {
    title: "Structured stages",
    hint: "Optional · 1–12 stages. Each needs an id, title, prompt, and either artifacts or verification: true. Leave empty to run a single prompt.",
    format: "Format JSON",
  },
  zh: {
    title: "结构化阶段",
    hint: "可选 · 1–12 个阶段。每阶段需要 id、title、prompt，以及 artifacts 或 verification: true。留空时作为单段提示词运行。",
    format: "格式化 JSON",
  },
  "zh-TW": {
    title: "結構化階段",
    hint: "選填 · 1–12 個階段。每階段需要 id、title、prompt，以及 artifacts 或 verification: true。留空時以單段提示詞執行。",
    format: "格式化 JSON",
  },
} satisfies Record<
  WebUiLanguage,
  { title: string; hint: string; format: string }
>;

/** Static translated workflow authoring fields; never accepts user HTML. */
export function renderWorkflowForm(
  copy: WorkflowFormCopy,
  language: WebUiLanguage,
): string {
  const stage = STAGE_COPY[language];
  return `<div class="capability-workflow-fields" id="capabilityWorkflowFields" hidden>
    <label class="field-label" for="capabilityArgumentHint">${copy.capabilityArgumentHint}</label>
    <input class="field-control" id="capabilityArgumentHint" type="text" maxlength="160" placeholder="[files or requirements]" autocomplete="off" />
    <label class="field-label" for="capabilitySkills">${copy.capabilitySkills}</label>
    <input class="field-control" id="capabilitySkills" type="text" maxlength="520" placeholder="${copy.capabilitySkillsHint}" autocomplete="off" />
    <details class="capability-stage-editor" id="capabilityStagesDetails">
      <summary><span>${stage.title}</span><small>JSON</small></summary>
      <div class="capability-stage-editor-body">
        <p id="capabilityStagesHint">${stage.hint}</p>
        <label class="sr-only" for="capabilityStages">${stage.title}</label>
        <textarea class="field-control capability-stages" id="capabilityStages" rows="8" maxlength="100000" spellcheck="false" aria-describedby="capabilityStagesHint capabilityStagesStatus" placeholder='[{"id":"verify","title":"Verify","prompt":"Run project checks","verification":true}]'></textarea>
        <div class="capability-stage-editor-footer">
          <span id="capabilityStagesStatus" role="status" aria-live="polite"></span>
          <button class="text-button" id="formatCapabilityStages" type="button">${stage.format}</button>
        </div>
      </div>
    </details>
  </div>
  <div class="capability-preview">
    <span class="field-label">${copy.capabilityPreview}</span>
    <code id="capabilityPreview">—</code>
  </div>`;
}
