import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { WEB_UI_CLIENT_CAPABILITIES_SCRIPT } from "./WebUiClientCapabilities.js";
import { WEB_UI_CLIENT_WORKFLOW_SCRIPT } from "./WebUiClientWorkflow.js";

function helpers(language = "en") {
  return runInNewContext(
    WEB_UI_CLIENT_CAPABILITIES_SCRIPT +
      WEB_UI_CLIENT_WORKFLOW_SCRIPT +
      "\n({ workflowDependencyMessage, skillActivationMessage });",
    {
      language,
      chinese: (simplified: string, traditional: string) =>
        language === "zh-TW" ? traditional : simplified,
      copy: { skillAuto: "Auto", skillExplicit: "Explicit" },
    },
  ) as {
    workflowDependencyMessage: (value: unknown) => string;
    skillActivationMessage: (value: unknown) => string;
  };
}

describe("WebUI capability feedback", () => {
  it("places field errors next to their input and resets request errors to the form actions", () => {
    const field = () => ({
      removeAttribute: vi.fn(),
      setAttribute: vi.fn(),
      insertAdjacentElement: vi.fn(),
      focus: vi.fn(),
    });
    const elements = {
      capabilityFormError: { hidden: true, textContent: "" },
      capabilityName: field(),
      capabilityDescription: field(),
      capabilityInstructions: field(),
      capabilitySkills: field(),
      capabilityStages: field(),
      capabilityStagesDetails: { open: false },
      createCapabilityButton: { parentElement: { before: vi.fn() } },
    };
    const { showCapabilityError, clearCapabilityError } = runInNewContext(
      WEB_UI_CLIENT_CAPABILITIES_SCRIPT +
        "\n({ showCapabilityError, clearCapabilityError });",
      { elements },
    ) as {
      showCapabilityError: (message: string, field?: unknown) => void;
      clearCapabilityError: () => void;
    };
    showCapabilityError("Reserved name", elements.capabilityName);
    expect(elements.capabilityName.insertAdjacentElement).toHaveBeenCalledWith(
      "afterend",
      elements.capabilityFormError,
    );
    expect(elements.capabilityName.focus).toHaveBeenCalledOnce();
    expect(elements.capabilityName.setAttribute).toHaveBeenCalledWith(
      "aria-describedby",
      "capabilityFormError",
    );
    expect(elements.capabilityFormError).toEqual({
      hidden: false,
      textContent: "Reserved name",
    });
    showCapabilityError("Invalid stage", elements.capabilityStages);
    expect(elements.capabilityStagesDetails.open).toBe(true);
    expect(
      elements.capabilityStages.insertAdjacentElement,
    ).toHaveBeenCalledWith("afterend", elements.capabilityFormError);
    showCapabilityError("Request failed");
    expect(
      elements.createCapabilityButton.parentElement.before,
    ).toHaveBeenCalledWith(elements.capabilityFormError);
    clearCapabilityError();
    expect(elements.capabilityFormError).toEqual({
      hidden: true,
      textContent: "",
    });
    expect(elements.capabilityStages.setAttribute).toHaveBeenLastCalledWith(
      "aria-describedby",
      "capabilityStagesHint capabilityStagesStatus",
    );
  });
  it("leaves ready workflows actionable", () => {
    expect(helpers().workflowDependencyMessage({})).toBe("");
  });
  it.each([
    [
      "en",
      "Enable Skills",
      "Missing Skills",
      "Skills pending review",
      "Disabled Skills",
    ],
    ["zh", "请启用", "缺少 Skill", "Skill 待审核", "Skill 已禁用"],
    ["zh-TW", "請啟用", "缺少 Skill", "Skill 待審核", "Skill 已停用"],
  ])("explains all dependency blockers in %s", (language, ...expected) => {
    const text = helpers(language).workflowDependencyMessage({
      skillsUnavailable: true,
      dependencyProblems: [
        { name: "missing", reason: "missing" },
        { name: "draft", reason: "draft" },
        { name: "disabled", reason: "disabled" },
      ],
    });
    for (const part of [...expected, "$missing", "$draft", "$disabled"])
      expect(text).toContain(part);
  });
  it.each([
    ["context-budget", "context budget"],
    ["auto-size-limit", "automatic Skill size limit"],
    ["skill-size-limit", "Skill size limit"],
  ])(
    "explains %s with the active Skill resource address",
    (truncationReason, expected) => {
      const text = helpers().skillActivationMessage({
        name: "review",
        activation: "auto",
        activationReason: "metadata-match",
        matchedTerms: 3,
        truncated: true,
        truncationReason,
      });
      expect(text).toContain("$review · metadata match (3)");
      expect(text).toContain(expected);
      expect(text).toContain("skill://review/SKILL.md in full before use");
    },
  );
  it("does not warn for an untruncated explicit invocation", () => {
    expect(
      helpers().skillActivationMessage({
        name: "review",
        activation: "explicit",
        truncated: false,
      }),
    ).toBe("$review · Explicit");
  });
});
