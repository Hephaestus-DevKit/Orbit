import { expect, test } from "@playwright/test";
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

test.beforeEach(async () => {
  submittedPrompts = [];
  sessionActions = [];
  abortedAgents = [];
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
  await page.locator("#activityTab").click();
  await expect(page.locator("#agentRunList")).toContainText(
    "reviewer:accessibility",
  );
  await expect(page.locator("#agentRunList")).toContainText("$0.1000 / $0.50");
  await page.locator('[data-agent-abort="agent_e2e"]').click();
  await expect.poll(() => abortedAgents).toEqual(["agent_e2e"]);
});

test("keeps task controls keyboard reachable on desktop and mobile", async ({
  page,
}) => {
  await page.goto(handle.url);
  await page.locator("#inspectorButton").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect(page.locator("#inspectorClose")).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
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
