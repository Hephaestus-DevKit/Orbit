import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { WorkflowStagesSchema } from "../workflows/WorkflowSchema.js";
import { WEB_UI_CLIENT_WORKFLOW_SCRIPT } from "./WebUiClientWorkflow.js";

function validator(language = "en"): (stages: unknown) => string {
  return runInNewContext(
    WEB_UI_CLIENT_WORKFLOW_SCRIPT + "\nvalidateWorkflowStages;",
    {
      language,
      chinese: (simplified: string, traditional: string) =>
        language === "zh-TW" ? traditional : simplified,
    },
  ) as (stages: unknown) => string;
}

describe("browser workflow validation", () => {
  const stage = {
    id: "verify",
    title: "Verify",
    prompt: "Run checks",
    verification: true,
  };
  const validate = validator();

  const invalid: Array<[string, unknown]> = [
    ["non-array", {}],
    ["empty stages", []],
    [
      "too many stages",
      Array.from({ length: 13 }, (_, index) => ({
        ...stage,
        id: String(index),
      })),
    ],
    ["null stage", [null]],
    ["array stage", [[]]],
    ["missing id", [{ title: "Title", prompt: "Prompt", verification: true }]],
    ["invalid id", [{ ...stage, id: "-bad" }]],
    ["long id", [{ ...stage, id: "a".repeat(49) }]],
    ["duplicate id", [stage, stage]],
    ["empty title", [{ ...stage, title: " " }]],
    ["long title", [{ ...stage, title: "a".repeat(121) }]],
    ["empty prompt", [{ ...stage, prompt: "\n" }]],
    ["long prompt", [{ ...stage, prompt: "a".repeat(12001) }]],
    ["invalid skills", [{ ...stage, skills: [42] }]],
    ["long skill name", [{ ...stage, skills: ["a".repeat(65)] }]],
    ["too many skills", [{ ...stage, skills: Array(9).fill("review") }]],
    ["null skills", [{ ...stage, skills: null }]],
    ["invalid verification", [{ ...stage, verification: "true" }]],
    ["missing gate", [{ ...stage, verification: false }]],
    ["invalid artifacts", [{ ...stage, artifacts: null }]],
    [
      "too many artifacts",
      [
        {
          ...stage,
          artifacts: Array.from({ length: 21 }, (_, index) => `${index}.md`),
        },
      ],
    ],
    [
      "reused artifact",
      [
        { ...stage, artifacts: ["REPORT.md"] },
        { ...stage, id: "two", artifacts: ["report.md"] },
      ],
    ],
    ["unknown field", [{ ...stage, command: "echo ok" }]],
    ["empty field name", [{ ...stage, "": true }]],
    ...[
      "../escape",
      "reports/../escape",
      "/absolute",
      "C:/escape",
      "a\\b",
      ".git/config",
      "x/.ORBIT/state",
      ".agents/skill",
      ".codex/config",
      "con.md",
      "a//b",
      "a/./b",
      "a./b",
      "a /b",
      "a?b",
      "a\u0000b",
      "a".repeat(501),
    ].map((path): [string, unknown] => [
      `unsafe path ${JSON.stringify(path)}`,
      [{ ...stage, artifacts: [path] }],
    ]),
  ];

  it.each(invalid)(
    "rejects %s consistently with the server",
    (_label, value) => {
      expect(WorkflowStagesSchema.safeParse(value).success).toBe(false);
      expect(validate(value)).not.toBe("");
    },
  );

  it.each([
    [stage],
    [
      {
        id: "artifact",
        title: "Artifact",
        prompt: "Write a report",
        artifacts: ["reports/分析.md"],
      },
    ],
    [{ ...stage, skills: ["a".repeat(64)] }],
    [
      {
        ...stage,
        title: " padded ",
        prompt: " padded ",
        skills: [],
        artifacts: [],
      },
    ],
    Array.from({ length: 12 }, (_, index) => ({
      ...stage,
      id: String(index),
      artifacts: [`reports/${index}.md`],
    })),
  ])("accepts valid server-compatible stages %#", (...stages) => {
    expect(WorkflowStagesSchema.safeParse(stages).success).toBe(true);
    expect(validate(stages)).toBe("");
  });

  it("identifies the failing stage in each supported language", () => {
    const stages = [stage, { ...stage, id: "second", verification: false }];
    expect(validator()(stages)).toBe(
      "Stage 2: add an artifact or set verification to true.",
    );
    expect(validator("zh")(stages)).toContain("阶段 2：请添加产物");
    expect(validator("zh-TW")(stages)).toContain("階段 2：請新增產物");
  });
});
