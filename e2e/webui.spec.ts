import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { eventBus } from "../packages/core/dist/index.js";
import {
  startOrbitWebUi,
  stopOrbitWebUi,
  type WebUiHandle,
} from "../packages/cli/src/runtime/webui/WebUiServer.js";

let handle: WebUiHandle;
let submittedPrompts: string[];
let sessionActions: string[];
let abortedAgents: string[];
let taskActions: string[];

test.beforeEach(async () => {
  submittedPrompts = [];
  sessionActions = [];
  abortedAgents = [];
  taskActions = [];
  handle = await startOrbitWebUi({
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    port: 0,
    open: false,
    loop: {
      getHistory: () => [
        {
          id: "assistant-welcome",
          role: "assistant",
          createdAt: "2026-07-19T00:00:00.000Z",
          metadata: { model: "deepseek-v4-flash" },
          content: [{ type: "text", text: "Browser runtime ready." }],
        },
      ],
      getSessions: () => [],
      getRelevantFiles: () => [],
      getSessionId: () => "e2e-session",
      getSessionReview: () => ({
        fileChanges: [
          {
            id: "e2e-change",
            path: "src/index.ts",
            diff: "@@ -1 +1 @@\n-old\n+new",
            createdAt: "2026-07-22T00:00:00.000Z",
          },
        ],
        checkpoints: [],
        verification: [],
      }),
    },
    submitPrompt: async (prompt) => {
      submittedPrompts.push(prompt);
      return { ok: true };
    },
    startTask: async (action) => {
      taskActions.push(action.action);
      return { ok: true };
    },
    updateSession: async (action) => {
      sessionActions.push(action.action);
      return { ok: true };
    },
    getAgentRuns: () => [
      {
        id: "run_e2e",
        task: "Inspect the Web UI",
        status: "running",
        budgetUsd: 2,
        costUsd: 0.25,
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:01:00.000Z",
        agents: [
          {
            id: "agent_e2e",
            role: "reviewer:accessibility",
            task: "Review keyboard and responsive behavior",
            status: "running",
            model: "deepseek-v4-pro",
            budgetUsd: 0.5,
            costUsd: 0.1,
            access: { mode: "read", scopes: ["workspace"] },
          },
        ],
      },
    ],
    controlAgent: async (action) => {
      abortedAgents.push(action.agentId);
      return { ok: true };
    },
  });
});

test.afterEach(async () => {
  await stopOrbitWebUi();
});

test("connects, chats, streams, and keeps the assistant mark aligned", async ({
  page,
}) => {
  await page.goto(handle.url);

  await expect(page.getByTestId("orbit-app")).toBeVisible();
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  await expect(page.getByText("Browser runtime ready.")).toBeVisible();

  const avatar = await page.locator(".message-avatar").first().boundingBox();
  const role = await page.locator(".message-role").first().boundingBox();
  expect(avatar).not.toBeNull();
  expect(role).not.toBeNull();
  expect(Math.abs((avatar?.y ?? 0) - (role?.y ?? 0))).toBeLessThanOrEqual(2);

  await page.getByTestId("composer-input").fill("inspect this project");
  await page.getByTestId("composer-send").click();
  await expect.poll(() => submittedPrompts).toEqual(["inspect this project"]);
  await expect(page.getByTestId("orbit-app")).not.toHaveClass(/is-busy/);

  expect(eventBus.listenerCount("*")).toBeGreaterThan(0);
  eventBus.emitEvent("ui_turn_started", {
    turnId: "browser-stream-turn",
    source: "terminal",
    prompt: "stream from terminal",
  });
  eventBus.emitEvent("model_delta", { text: "Synchronized stream output" });
  await expect(page.getByText("Synchronized stream output")).toBeVisible();
});

test("creates chats and remains responsive without horizontal overflow", async ({
  page,
}) => {
  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);

  await page.getByTestId("new-chat").click();
  await expect.poll(() => sessionActions).toContain("new");

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  }
});

test("reviews changes and stages image attachments without layout regressions", async ({
  page,
}) => {
  await page.goto(handle.url);
  await page.getByTestId("changes").click();
  await expect(page.getByTestId("changes-list")).toContainText("src/index.ts");
  await expect(page.getByTestId("changes-list")).toContainText("+new");

  await page.getByTestId("attachment-input").setInputFiles({
    name: "screen.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await expect(page.locator(".attachment-card")).toContainText("screen.png");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

test("launches focused reviews and controls durable agents", async ({
  page,
}) => {
  await page.goto(handle.url);
  await page.getByTestId("changes").click();
  await page.locator('[data-review-preset="security"]').click();
  await expect.poll(() => submittedPrompts).toContain("/review security");

  await page.locator("#inspectorButton").click();
  await page.locator("#tasksTab").click();
  await expect(page.locator("#agentRunList")).toContainText(
    "reviewer:accessibility",
  );
  await expect(page.locator("#agentRunList")).toContainText("$0.1000 / $0.50");
  await page.locator('[data-agent-abort="agent_e2e"]').click();
  await expect.poll(() => abortedAgents).toEqual(["agent_e2e"]);
});

test("keeps the task center keyboard reachable on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.goto(handle.url);
  await page.getByTestId("tasks").click();
  await expect(page.locator("#tasksPanel")).toBeVisible();
  await expect(page.locator("#taskOverview")).toContainText("Untitled task");
  await expect(page.locator("#taskOverview")).toContainText("Running");
  await expect(page.locator("#taskOverview")).toContainText("1 / 1");
  await expect(page.locator("#agentRunList")).toContainText(
    "reviewer:accessibility",
  );
  await expect(page.locator("#buildPlanButton")).toBeEnabled();
  await page.locator("#buildPlanButton").click();
  await expect.poll(() => taskActions).toEqual(["plan"]);
  await expect(page.getByTestId("orbit-app")).not.toHaveClass(/is-busy/);
  await page.locator("#parallelImproveButton").click();
  await expect.poll(() => taskActions).toEqual(["plan", "parallel-improve"]);
  await expect(page.getByTestId("orbit-app")).not.toHaveClass(/is-busy/);
  await page.screenshot({
    path: testInfo.outputPath("task-center-desktop.png"),
  });
  await page.locator("#inspectorClose").click();
  await expect(page.getByTestId("tasks")).toBeFocused();

  await page.locator("#inspectorButton").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect(page.locator("#inspectorClose")).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#taskOverview")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".task-overview-stats")
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#inspector")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator("#inspectorButton")).toBeFocused();
});

test("discovers terminal-style slash commands and argument suggestions", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  await expect(page.locator(".composer-hint")).toContainText(
    "Type / for commands",
  );

  const composer = page.getByTestId("composer-input");
  await composer.fill("/");
  await expect(page.locator("#slashCommandMenu")).toBeVisible();
  await expect(
    page.locator(".slash-command-option").filter({ hasText: "/language" }),
  ).toHaveCount(1);

  await composer.fill("/language ");
  const argumentOptions = page.locator(".slash-command-option");
  await expect(argumentOptions).toHaveCount(3);
  await expect(argumentOptions).toContainText([
    "/language en",
    "/language zh",
    "/language zh-TW",
  ]);
  await page.screenshot({
    path: testInfo.outputPath("slash-command-menu.png"),
  });
  await composer.press("ArrowDown");
  await composer.press("ArrowDown");
  await composer.press("Tab");
  await expect(composer).toHaveValue("/language zh-TW");
  expect(browserErrors).toEqual([]);
});

test("creates a workflow from settings and exposes it as a slash command", async ({
  page,
}) => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-workflow-e2e-"));
  await stopOrbitWebUi();
  try {
    handle = await startOrbitWebUi({
      cwd,
      config: DEFAULT_CONFIG,
      port: 0,
      open: false,
    });
    await page.goto(handle.url);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);

    await page.locator("#inspectorButton").click();
    await page.locator("#settingsTab").click();
    await page.locator("#addCapabilityButton").click();
    await page.locator('[data-capability-kind="workflow"]').click();
    await expect(page.locator("#capabilityDescription")).toHaveAttribute(
      "maxlength",
      "240",
    );
    await page.locator("#capabilityName").fill("mcm-draft");
    await page
      .locator("#capabilityDescription")
      .fill("Draft a mathematical modeling paper");
    await page
      .locator("#capabilityInstructions")
      .fill("Analyze the supplied data and draft a structured paper.");
    await page.locator("#createCapabilityButton").click();
    await expect(page.locator("#workflowList")).toContainText("mcm-draft");

    await page.locator("#inspectorClose").click();
    const composer = page.getByTestId("composer-input");
    await composer.fill("/mcm");
    await expect(
      page.locator(".slash-command-option").filter({ hasText: "/mcm-draft" }),
    ).toHaveCount(1);
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});
