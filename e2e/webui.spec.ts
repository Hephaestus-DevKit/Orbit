import { expect, test } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { applyPermissionModePreset } from "../packages/config/src/PermissionMode.js";
import { eventBus } from "../packages/core/dist/index.js";
import {
  startOrbitWebUi,
  stopOrbitWebUi,
  type WebUiHandle,
} from "../packages/cli/src/runtime/webui/WebUiServer.js";
import type {
  WebUiApprovalSnapshot,
  WebUiProjectErrorCode,
} from "../packages/cli/src/runtime/webui/WebUiContracts.js";
import type { OrbitMessage } from "../packages/model-providers/src/types.js";

let handle: WebUiHandle;
let submittedPrompts: string[];
let sessionActions: string[];
let abortedAgents: string[];
let steeredAgents: Array<{ agentId: string; prompt: string }>;
let resumedAgents: Array<{ runId: string; agentId: string }>;
let taskActions: string[];
let projectActions: Array<{ action: string; path?: string }>;
let projectLaunchDelayMs: number;
let projectFailureMessage: string | undefined;
let projectFailureCode: WebUiProjectErrorCode | undefined;
let projectFixtures: Array<{
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
  available: boolean;
}>;
let sessionFixtures: Array<{
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}>;
let historyFixtures: OrbitMessage[] | undefined;

test.beforeEach(async () => {
  submittedPrompts = [];
  sessionActions = [];
  abortedAgents = [];
  steeredAgents = [];
  resumedAgents = [];
  taskActions = [];
  projectActions = [];
  projectLaunchDelayMs = 0;
  projectFailureMessage = undefined;
  projectFailureCode = undefined;
  projectFixtures = [];
  sessionFixtures = [];
  historyFixtures = undefined;
  handle = await startOrbitWebUi({
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    port: 0,
    open: false,
    getProjects: () => projectFixtures,
    loop: {
      getHistory: () =>
        historyFixtures ??
        Array.from({ length: 100 }, (_, index) => ({
          id: `history-${index}`,
          role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
          createdAt: new Date(
            Date.parse("2026-07-19T00:00:00.000Z") + index * 60_000,
          ).toISOString(),
          metadata: index % 2 === 0 ? undefined : { model: "deepseek-flash" },
          content: [
            {
              type: "text" as const,
              text:
                index === 99
                  ? "Browser runtime ready."
                  : `Conversation history message ${index + 1}.`,
            },
          ],
        })),
      getSessions: () => sessionFixtures,
      getRelevantFiles: () => [
        { path: "packages/cli/src/runtime/webui/WebUiPage.ts" },
        {
          path: "packages/cli/src/runtime/webui/styles/WebUiContextStyles.ts",
          readOnly: true,
        },
      ],
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
    openProject: async (action) => {
      projectActions.push({
        action: action.action,
        ...(action.action === "open" || action.action === "create"
          ? { path: action.path }
          : {}),
      });
      if (action.action === "pick") {
        return { ok: true, path: "C:/workspace/picked-project" };
      }
      if (action.action === "remove") return { ok: true };
      if (projectLaunchDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, projectLaunchDelayMs),
        );
      }
      if (projectFailureMessage) {
        return {
          ok: false,
          message: projectFailureMessage,
          ...(projectFailureCode ? { errorCode: projectFailureCode } : {}),
        };
      }
      const normalizedPath = action.path.replace(/\\/g, "/");
      projectFixtures = [
        {
          id: `proj_${String(projectFixtures.length + 1).padStart(16, "0")}`,
          path: action.path,
          name:
            normalizedPath.split("/").filter(Boolean).pop() || "Orbit project",
          lastOpenedAt: new Date().toISOString(),
          available: true,
        },
        ...projectFixtures.filter((project) => project.path !== action.path),
      ];
      return { ok: true, url: handle.url };
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
          {
            id: "agent_resume",
            role: "coder:recovery",
            task: "Resume interrupted implementation",
            status: "failed",
            model: "deepseek-flash",
            sessionId: "sess_friendly-panda-123",
            budgetUsd: 0.5,
            costUsd: 0.05,
            access: { mode: "write", scopes: ["workspace"] },
          },
        ],
      },
    ],
    controlAgent: async (action) => {
      if (action.action === "abort") abortedAgents.push(action.agentId);
      else if (action.action === "steer")
        steeredAgents.push({ agentId: action.agentId, prompt: action.prompt });
      else resumedAgents.push({ runId: action.runId, agentId: action.agentId });
      return { ok: true };
    },
  });
});

for (const width of [1280, 390]) {
  test(`current DeepSeek model picker is keyboard accessible at ${width}px`, async ({
    page,
  }, testInfo) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    historyFixtures = [
      {
        id: "picker-ready",
        role: "assistant",
        createdAt: "2026-09-19T00:00:00.000Z",
        content: [{ type: "text", text: "Browser runtime ready." }],
      },
    ];
    await page.setViewportSize({ width, height: 900 });
    await page.goto(handle.url);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
    await expect(page.getByText("Browser runtime ready.")).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    if (width < 560) {
      // The compact header intentionally uses the settings picker instead.
      await page.keyboard.press("Control+,");
      const select = page.locator("#settingsModelSelect");
      await expect(select).toHaveAccessibleName(/model/i);
      await expect(select.locator("option")).toHaveText([
        "Auto · deepseek-flash / deepseek-v4-pro",
        "deepseek-flash",
        "deepseek-v4-pro",
      ]);
      await select.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(select).toBeFocused();
      const bounds = await select.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`model-picker-${width}.png`),
      });
      expect(browserErrors).toEqual([]);
      return;
    }
    const trigger = page.locator("#modelSelectTrigger");
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveAccessibleName(/model/i);
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.locator("#modelSelectMenu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveText([
      "Auto · deepseek-flash / deepseek-v4-pro",
      "deepseek-flash",
      "deepseek-v4-pro",
    ]);
    await page.keyboard.press("ArrowDown");
    await expect(
      menu.getByRole("option", { name: "deepseek-flash", exact: true }),
    ).toBeFocused();
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(menu).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: testInfo.outputPath(`model-picker-${width}.png`),
      animations: "disabled",
    });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(browserErrors).toEqual([]);
  });
}

test("keeps the browser desktop-sized and restores the chat at narrower widths", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(handle.url);
  await page.locator("#prompt").fill("Keep this draft while browsing.");
  await page.locator("#browserPreviewButton").click();
  await expect(page.locator("#conversation")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.locator("#browserPreviewStage").boundingBox())?.width,
    )
    .toBeGreaterThanOrEqual(740);

  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator("#conversation")).toBeHidden();
  await expect(page.locator("#browserPreviewFocus")).toBeHidden();
  await expect
    .poll(
      async () =>
        (await page.locator("#browserPreviewStage").boundingBox())?.width,
    )
    .toBeGreaterThanOrEqual(1000);
  await page.screenshot({
    path: testInfo.outputPath("browser-narrow-desktop.png"),
    animations: "disabled",
  });
  await page.locator("#browserPreviewHide").click();
  await expect(page.locator("#conversation")).toBeVisible();
  await expect(page.locator("#prompt")).toHaveValue(
    "Keep this draft while browsing.",
  );
});

test("keeps sidebar metadata and browser state readable without widening the shell", async ({
  page,
}, testInfo) => {
  projectFixtures = [
    {
      id: "proj_sidebar_readability_1",
      path: join(
        process.cwd(),
        "fixtures",
        "a-long-project-folder-name-for-readability",
      ),
      name: "Orbit documentation project",
      lastOpenedAt: "2026-09-27T08:00:00.000Z",
      available: true,
    },
  ];
  sessionFixtures = [
    {
      id: "e2e-session",
      title: "Browser layout review",
      model: "deepseek-v4-pro",
      updatedAt: "2026-09-27T08:00:00.000Z",
    },
  ];
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(handle.url);
  await page.locator("#browserPreviewButton").click();
  const projectPath = page
    .locator(".registered-project .project-copy small")
    .first();
  const projectName = page
    .locator(".registered-project .project-copy strong")
    .first();
  const sessionMeta = page.locator(".recent-session-meta").first();
  const browserStatus = page.locator("#browserPreviewStatus");
  await expect(projectPath).toBeVisible();
  await expect(projectName).toHaveAttribute("title", projectFixtures[0]!.name);
  await expect(projectPath).toHaveAttribute("title", projectFixtures[0]!.path);
  await expect(sessionMeta).toBeVisible();
  await expect(browserStatus).toBeVisible();
  expect(
    await projectPath.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).fontSize),
    ),
  ).toBeGreaterThanOrEqual(11.5);
  expect(
    await sessionMeta.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).fontSize),
    ),
  ).toBeGreaterThanOrEqual(10.5);
  expect(
    await browserStatus.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).fontSize),
    ),
  ).toBeGreaterThanOrEqual(12);
  expect(
    await page
      .locator("#sidebar")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("readability-desktop.png"),
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1100, height: 760 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(browserStatus).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("readability-narrow-dark.png"),
    animations: "disabled",
  });
  expect(browserErrors).toEqual([]);
});

test("keeps model search stable across status refreshes and fits its menu beside the composer", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let catalogRevision = 0;
  historyFixtures = [];
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    status.modelOptions.push(
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `review-model-${index}`,
        label: `Review model ${index}${catalogRevision ? " updated" : ""}`,
      })),
    );
    await route.fulfill({ response, json: status });
  });
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.goto(handle.url);
  await expect(page.locator("#modelSelectTrigger")).toBeEnabled();
  await page.locator("#browserPreviewButton").click();
  await page.locator("#modelSelectTrigger").click();
  const menu = page.locator("#modelSelectMenu");
  const placement = await menu.getAttribute("data-placement");
  const bounds = await menu.boundingBox();
  const trigger = await page.locator("#modelSelectTrigger").boundingBox();
  expect(
    bounds!.y + bounds!.height <= trigger!.y - 5 ||
      bounds!.y >= trigger!.y + trigger!.height + 5,
  ).toBe(true);
  await menu.getByRole("searchbox").fill("Review model 2");
  const refreshed = page.waitForResponse("**/api/status");
  eventBus.emitEvent("cost_update", {
    turnCost: 0,
    sessionCost: 0,
    costKnown: true,
    totalInputTokens: 0,
    totalCacheReadTokens: 0,
    totalOutputTokens: 0,
  });
  await refreshed;
  await expect(menu.getByRole("searchbox")).toHaveValue("Review model 2");
  await expect(menu.getByRole("searchbox")).toBeFocused();
  await expect(menu.getByRole("option")).toHaveCount(5);
  await expect(menu).toHaveAttribute("data-placement", placement!);
  catalogRevision++;
  const catalogRefresh = page.waitForResponse("**/api/status");
  eventBus.emitEvent("cost_update", {
    turnCost: 0,
    sessionCost: 0,
    costKnown: true,
    totalInputTokens: 0,
    totalCacheReadTokens: 0,
    totalOutputTokens: 0,
  });
  await catalogRefresh;
  await expect(menu.getByRole("option").first()).toContainText("updated");
  await expect(menu.getByRole("searchbox")).toHaveValue("Review model 2");
  await expect(menu.getByRole("searchbox")).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("model-search-workbench.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Tab");
  await expect(menu).toBeHidden();
  await expect(page.locator("#contextPickerButton")).toBeFocused();
  historyFixtures = [
    {
      id: "model-picker-ready",
      role: "assistant",
      createdAt: "2026-09-22T00:00:00Z",
      content: [{ type: "text", text: "Ready to inspect this workspace." }],
    },
  ];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await page.locator("#modelSelectTrigger").click();
  await expect(menu).toHaveAttribute("data-placement", "top");
  const bottomComposer = await page
    .locator("#modelSelectTrigger")
    .boundingBox();
  const upperMenu = await menu.boundingBox();
  expect(upperMenu!.y).toBeGreaterThanOrEqual(10);
  expect(upperMenu!.y + upperMenu!.height).toBeLessThanOrEqual(
    bottomComposer!.y - 5,
  );
  await page.screenshot({
    path: testInfo.outputPath("model-search-desktop-dark.png"),
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("keeps floating selects inside modal boundaries and preserves the next keyboard stop", async ({
  page,
}) => {
  await page.goto(handle.url);
  await page.locator("#modelSelectTrigger").click();
  await page.keyboard.press("Control+,");
  await expect(page.locator("#modelSelectMenu")).toBeHidden();
  await expect(page.locator("#inspectorClose")).toBeFocused();
  await page.locator("#searchProviderTrigger").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#searchProviderMenu")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator("#searchProviderMenu")).toBeHidden();
  await expect(page.locator("#searchMax")).toBeFocused();
  await page.locator("#searchProviderTrigger").click();
  await page.keyboard.press("Control+k");
  await expect(page.locator("#searchProviderMenu")).toBeHidden();
  await expect(page.locator("#commandSearch")).toBeFocused();
  await page.locator("#commandSearch").fill("Focus message composer");
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator("#prompt")).toBeFocused();
});

test("reveals pending approval from a focused workbench without deciding it", async ({
  page,
}) => {
  let approval: WebUiApprovalSnapshot | undefined;
  let decisions = 0;
  await page.route("**/api/approval", async (route) => {
    decisions++;
    await route.abort();
  });
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), approval },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(handle.url);
  await page.locator("#prompt").fill("Keep my draft during approval.");
  await page.locator("#browserPreviewButton").click();
  await page.locator("#browserPreviewFocus").click();
  await expect(page.locator("#conversation")).toBeHidden();
  await page.keyboard.press("Control+k");
  await page.locator("#commandSearch").fill("Focus message composer");
  await page.keyboard.press("Enter");
  await expect(page.locator("#prompt")).toBeFocused();
  await page.locator("#browserPreviewFocus").click();
  approval = {
    id: "b2a4c5ce-0000-4000-8000-000000000072",
    kind: "tool",
    title: "Review this command",
    reason: "This action needs your approval.",
    preview: "npm test",
    requestedAt: new Date().toISOString(),
  };
  eventBus.emitEvent("web_approval_requested", {
    approvalId: approval.id,
    kind: approval.kind,
    title: approval.title,
  });
  await expect(page.locator("#approvalPanel")).toBeVisible();
  await expect(page.locator("#approveApprovalButton")).toBeInViewport();
  await expect(page.locator("#prompt")).toHaveValue(
    "Keep my draft during approval.",
  );
  expect(decisions).toBe(0);
  await page.setViewportSize({ width: 1000, height: 760 });
  await expect(page.locator("#conversation")).toBeHidden();
  approval = { ...approval, id: "b2a4c5ce-0000-4000-8000-000000000073" };
  eventBus.emitEvent("web_approval_requested", {
    approvalId: approval.id,
    kind: approval.kind,
    title: approval.title,
  });
  await expect(page.locator("#approvalPanel")).toBeVisible();
  await expect(page.locator("#workbench")).toBeHidden();
  expect(decisions).toBe(0);
});

test("locks composer selects immediately when a run starts and restores them on completion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let running = false;
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        turn: running
          ? { active: true, id: "picker-busy-turn", sessionId: "e2e-session" }
          : { active: false },
      },
    });
  });
  await page.goto(handle.url);
  await page.locator("#modelSelectTrigger").click();
  await expect(page.locator("#modelSelectMenu")).toBeVisible();
  running = true;
  eventBus.emitEvent("ui_turn_started", {
    turnId: "picker-busy-turn",
    source: "terminal",
    prompt: "Inspect the project",
  });
  await expect(page.locator("#modelSelectMenu")).toBeHidden();
  for (const id of [
    "providerSelectTrigger",
    "modelSelectTrigger",
    "permissionSelectTrigger",
  ])
    await expect(page.locator(`#${id}`)).toBeDisabled();
  running = false;
  eventBus.emitEvent("ui_turn_completed", {
    turnId: "picker-busy-turn",
    source: "terminal",
    status: "aborted",
  });
  for (const id of [
    "providerSelectTrigger",
    "modelSelectTrigger",
    "permissionSelectTrigger",
  ])
    await expect(page.locator(`#${id}`)).toBeEnabled();
  await page.locator("#modelSelectTrigger").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#modelSelectMenu")).toBeVisible();
  expect(errors).toEqual([]);
});

test("does not recreate retired model options from a stale session override", async ({
  page,
}) => {
  await stopOrbitWebUi();
  const config = structuredClone(DEFAULT_CONFIG);
  config.models.default = "deepseek-v4-flash";
  config.providers.deepseek.models = [
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
  ];
  handle = await startOrbitWebUi({
    cwd: process.cwd(),
    config,
    port: 0,
    open: false,
    loop: { getModelOverride: () => "deepseek-v4-flash-vision-exp" },
  });
  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  for (const id of ["modelSelect", "settingsModelSelect"]) {
    const options = page.locator(`#${id} option`);
    await expect(options).toHaveText([
      "Select a supported model",
      "deepseek-flash",
      "Auto · deepseek-flash / deepseek-v4-pro",
      "deepseek-v4-pro",
    ]);
    await expect(options.first()).toBeDisabled();
  }
  expect(config.models.default).toBe("deepseek-v4-flash");
});

test("groups consecutive low-noise tools and keeps redacted details inspectable", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  historyFixtures = [
    {
      id: "tool-sequence",
      role: "assistant",
      createdAt: "2026-08-15T00:00:00.000Z",
      content: [
        {
          type: "tool_call",
          toolCall: {
            id: "read-sequence",
            name: "read_file",
            arguments: JSON.stringify({ path: "src/app.ts" }),
          },
        },
        {
          type: "tool_call",
          toolCall: {
            id: "grep-sequence",
            name: "grep",
            arguments: JSON.stringify({ query: "TODO", path: "src" }),
          },
        },
        {
          type: "tool_call",
          toolCall: {
            id: "shell-sequence",
            name: "bash",
            arguments: JSON.stringify({
              command: "pnpm test --token private-token",
            }),
          },
        },
      ],
    },
    {
      id: "tool-sequence-results",
      role: "tool",
      createdAt: "2026-08-15T00:00:01.000Z",
      content: [
        {
          type: "tool_result",
          toolResult: {
            toolCallId: "read-sequence",
            name: "read_file",
            content: "Read src/app.ts",
            isError: false,
          },
        },
        {
          type: "tool_result",
          toolResult: {
            toolCallId: "grep-sequence",
            name: "grep",
            content: "Found 2 matches",
            isError: false,
          },
        },
        {
          type: "tool_result",
          toolResult: {
            toolCallId: "shell-sequence",
            name: "bash",
            content: "Tests passed",
            isError: false,
          },
        },
      ],
    },
  ];

  await page.goto(handle.url);

  const batch = page.locator(".tool-batch");
  await expect(batch).toHaveCount(1);
  await expect(batch).toHaveClass(/is-success/);
  await expect(batch.locator(".tool-batch-count")).toHaveText("×3");
  await expect(batch.locator(".tool-batch-summary")).toContainText(
    "Tool steps",
  );
  await expect(batch.locator(".tool-batch-summary")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(batch.locator(".tool-card").first()).not.toBeVisible();

  await batch.locator(".tool-batch-summary").click();
  await expect(batch.locator(".tool-batch-summary")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(batch.locator(".tool-card")).toHaveCount(3);
  await expect(batch.getByText("Shell", { exact: true })).toBeVisible();
  await batch.getByText("Shell", { exact: true }).click();
  await expect(batch).toContainText("***REDACTED***");
  await expect(batch).not.toContainText("private-token");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(batch.locator(".tool-batch-summary")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const workspace = document.querySelector(".workspace-view");
        if (!workspace) return false;
        const bounds = workspace.getBoundingClientRect();
        return (
          Math.abs(bounds.left) <= 0.5 && Math.abs(bounds.width - 390) <= 0.5
        );
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("tool-batch-mobile.png"),
  });
  expect(browserErrors).toEqual([]);
});

test.afterEach(async () => {
  await stopOrbitWebUi();
});

test("connects, chats, streams, and keeps the assistant mark aligned", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(handle.url);
  const initialViewport = page.viewportSize();

  await expect(page.getByTestId("orbit-app")).toBeVisible();
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  await expect(page.getByText("Browser runtime ready.")).toBeVisible();

  const avatar = await page.locator(".message-avatar").first().boundingBox();
  const role = await page.locator(".message-role").first().boundingBox();
  expect(avatar).not.toBeNull();
  expect(role).not.toBeNull();
  expect(Math.abs((avatar?.y ?? 0) - (role?.y ?? 0))).toBeLessThanOrEqual(2);

  expect(eventBus.listenerCount("*")).toBeGreaterThan(0);
  eventBus.emitEvent("ui_turn_started", {
    turnId: "browser-stream-turn",
    source: "terminal",
    prompt: "stream from terminal",
  });
  eventBus.emitEvent("model_delta", {
    text: "# Synchronized stream output\n\n**Rendered",
  });
  const streamingMessage = page.locator(
    '[data-message-id="streaming-browser-stream-turn"]',
  );
  await expect(streamingMessage.locator("h1")).toHaveText(
    "Synchronized stream output",
  );
  await expect(streamingMessage.locator("strong")).toHaveText("Rendered");
  await expect(streamingMessage).not.toContainText("**Rendered");
  eventBus.runWithContext(
    { sessionId: "another-session", runId: "concurrent-run" },
    () => eventBus.emitEvent("model_delta", { text: "FOREIGN_SESSION_OUTPUT" }),
  );
  eventBus.emitEvent("model_delta", {
    text: " immediately**\n\n- rendered immediately\n\n```ts\nconst answer = ",
  });
  await expect(streamingMessage.locator("li")).toHaveText(
    "rendered immediately",
  );
  await expect(
    streamingMessage.locator(".code-block.is-streaming"),
  ).toBeVisible();
  await expect(streamingMessage).not.toContainText("```ts");
  await expect(streamingMessage).not.toContainText("FOREIGN_SESSION_OUTPUT");
  eventBus.emitEvent("model_delta", { text: "42;\n```" });
  await expect(streamingMessage.locator(".code-block")).toContainText(
    "const answer = 42;",
  );
  await page.screenshot({
    path: testInfo.outputPath("streaming-markdown.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(streamingMessage).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("#messageScroll")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("streaming-markdown-narrow.png"),
  });
  if (initialViewport) await page.setViewportSize(initialViewport);
  eventBus.emitEvent("ui_turn_completed", {
    turnId: "browser-stream-turn",
    source: "terminal",
    status: "aborted",
  });
  await expect(page.getByTestId("orbit-app")).not.toHaveClass(/is-busy/);

  await page.getByTestId("composer-input").fill("inspect this project");
  await page.getByTestId("composer-send").click();
  await expect.poll(() => submittedPrompts).toEqual(["inspect this project"]);
  await expect(page.getByTestId("orbit-app")).not.toHaveClass(/is-busy/);
  expect(browserErrors).toEqual([]);
});

test("reviews earlier messages and keeps slash-command progress in the timeline", async ({
  page,
}) => {
  await page.goto(handle.url);
  const messageScroll = page.locator("#messageScroll");
  await expect
    .poll(() =>
      messageScroll.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);

  await expect(page.locator("#jumpEarlier")).toHaveClass(/is-visible/);
  await expect(
    page.getByText("Conversation history message 1."),
  ).not.toBeAttached();
  await page.locator("#jumpEarlier").click();
  await expect(page.getByText("Conversation history message 1.")).toBeVisible();
  await expect
    .poll(() => messageScroll.evaluate((element) => element.scrollTop))
    .toBe(0);
  await expect(page.locator("#jumpEarlier")).not.toHaveClass(/is-visible/);

  await messageScroll.hover();
  await page.mouse.wheel(0, 420);
  await expect(page.locator("#jumpEarlier")).toHaveClass(/is-visible/);
  await page.locator("#jumpEarlier").click();
  await expect
    .poll(() => messageScroll.evaluate((element) => element.scrollTop))
    .toBe(0);

  const composer = page.getByTestId("composer-input");
  await composer.fill("/compact");
  await page.getByTestId("composer-send").click();
  await expect.poll(() => submittedPrompts).toContain("/compact");
  const commandTurn = page.locator(".control-turn").filter({
    hasText: "/compact",
  });
  await expect(commandTurn).toContainText("Done");
  await expect(commandTurn).toHaveClass(/is-completed/);
});

test("edits and reorders the durable follow-up queue without crowding the composer", async ({
  page,
}) => {
  await stopOrbitWebUi();
  let queuedInputs: Array<{
    id: string;
    mode: "follow_up" | "steer";
    source: "terminal" | "web";
    text: string;
    attachments: never[];
    createdAt: string;
  }> = [
    {
      id: "input_e2e_tests",
      mode: "follow_up" as const,
      source: "web" as const,
      text: "Run focused tests.",
      attachments: [],
      createdAt: "2026-08-03T00:00:00.000Z",
    },
    {
      id: "input_e2e_docs",
      mode: "follow_up" as const,
      source: "terminal" as const,
      text: "Document the result.",
      attachments: [],
      createdAt: "2026-08-03T00:01:00.000Z",
    },
  ];
  handle = await startOrbitWebUi({
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    port: 0,
    loop: {
      getSessionId: () => "queue-e2e-session",
      getHistory: () => [],
      getQueuedInputs: () => queuedInputs,
    },
    updateInputQueue: (action) => {
      if (action.action === "update") {
        queuedInputs = queuedInputs.map((item) =>
          item.id === action.inputId
            ? {
                ...item,
                ...(action.prompt !== undefined ? { text: action.prompt } : {}),
                ...(action.mode !== undefined ? { mode: action.mode } : {}),
              }
            : item,
        );
      } else if (action.action === "move") {
        const fromIndex = queuedInputs.findIndex(
          (item) => item.id === action.inputId,
        );
        const toIndex = fromIndex + (action.direction === "up" ? -1 : 1);
        if (fromIndex >= 0 && toIndex >= 0 && toIndex < queuedInputs.length) {
          const reordered = [...queuedInputs];
          const [item] = reordered.splice(fromIndex, 1);
          reordered.splice(toIndex, 0, item);
          queuedInputs = reordered;
        }
      }
      return { ok: true };
    },
  });

  await page.goto(handle.url);
  await page.getByRole("button", { name: "Edit message" }).first().click();
  const editor = page.getByRole("textbox", { name: "Edit message" });
  await expect(editor).toBeFocused();
  await editor.fill("Run tests, lint, and the installation smoke check.");
  eventBus.emitEvent("agent_input_moved", {
    inputId: "input_e2e_docs",
    sessionId: "queue-e2e-session",
    mode: "follow_up",
    source: "terminal",
    remaining: 2,
    fromIndex: 1,
    toIndex: 0,
  });
  await expect(editor).toHaveValue(
    "Run tests, lint, and the installation smoke check.",
  );
  await editor.press("Control+Enter");
  await expect(page.locator(".prompt-queue-text").first()).toContainText(
    "installation smoke check",
  );

  await page.getByRole("button", { name: "Move earlier" }).last().click();
  await expect(page.locator(".prompt-queue-text").first()).toHaveText(
    "Document the result.",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Remove queued message" }).first(),
  ).toBeVisible();
});

test("keeps active files out of the typing area and manages them in the context popover", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  await expect(page.locator("#contextChipCount")).toHaveText("2");
  await expect(page.locator("#contextShelf")).not.toBeVisible();

  const composerHeight = await page
    .locator("#composer")
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(composerHeight).toBeLessThan(150);

  const trigger = page.locator("#contextPickerButton");
  await trigger.click();
  await expect(page.locator("#contextPicker")).toBeVisible();
  await expect(page.locator("#contextShelf")).toBeVisible();
  await expect(page.locator(".context-file-chip")).toHaveCount(2);
  await expect(page.locator(".context-file-chip").first()).toContainText(
    "WebUiPage.ts",
  );
  await expect(page.locator(".context-file-chip").first()).toContainText(
    "packages/cli/src/runtime/webui",
  );
  await page.screenshot({
    path: testInfo.outputPath("context-popover-desktop.png"),
  });

  await page.locator(".context-file-remove").first().click();
  await expect
    .poll(() => submittedPrompts)
    .toContain("/drop packages/cli/src/runtime/webui/WebUiPage.ts");
  await expect(page.locator("#contextPicker")).not.toBeVisible();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(page.locator("#contextPicker")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#contextPicker")).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const closedComposerHeight = await page
    .locator("#composer")
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(closedComposerHeight - composerHeight)).toBeLessThan(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(page.locator("#contextPicker")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const pickerBounds = await page.locator("#contextPicker").boundingBox();
  expect(pickerBounds).not.toBeNull();
  expect(pickerBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(
    (pickerBounds?.x ?? 0) + (pickerBounds?.width ?? 0),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("context-popover-mobile.png"),
  });
  expect(browserErrors).toEqual([]);
});

test("creates chats and remains responsive without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);

  await page.getByTestId("new-chat").click();
  await expect.poll(() => sessionActions).toContain("new");

  for (const viewport of [
    { width: 1280, height: 720 },
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
    await expect
      .poll(() =>
        page.evaluate(() => {
          const shell = document.querySelector(".app-shell");
          const workspace = document.querySelector(".workspace-view");
          const composer = document.querySelector("#composerDock");
          if (!shell || !workspace || !composer) return false;
          return [shell, workspace, composer].every((element) => {
            const bounds = element.getBoundingClientRect();
            return (
              bounds.top >= -0.5 && bounds.bottom <= window.innerHeight + 0.5
            );
          });
        }),
      )
      .toBe(true);
  }
  const toastBounds = await page.locator(".toast").first().boundingBox();
  const composerBounds = await page.locator("#composerDock").boundingBox();
  expect(toastBounds).not.toBeNull();
  expect(composerBounds).not.toBeNull();
  expect(toastBounds?.y ?? 0).toBeLessThan(composerBounds?.y ?? 0);
  expect(
    (toastBounds?.y ?? 0) + (toastBounds?.height ?? 0),
  ).toBeLessThanOrEqual(composerBounds?.y ?? 0);
  for (const selector of [
    "#contextPickerButton",
    "#attachmentButton",
    "#searchToggle",
    "#permissionSelectTrigger",
    "#sendButton",
  ]) {
    const control = page.locator(selector);
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds, `${selector} should have layout bounds`).not.toBeNull();
    expect(bounds?.x ?? -1, `${selector} left edge`).toBeGreaterThanOrEqual(0);
    expect(
      (bounds?.x ?? 0) + (bounds?.width ?? 0),
      `${selector} right edge`,
    ).toBeLessThanOrEqual(390);
    expect(
      (bounds?.y ?? 0) + (bounds?.height ?? 0),
      `${selector} bottom edge`,
    ).toBeLessThanOrEqual(844);
    if (["#contextPickerButton", "#attachmentButton"].includes(selector)) {
      expect(
        bounds?.height ?? 0,
        `${selector} touch height`,
      ).toBeGreaterThanOrEqual(36);
    }
  }
  await expect(page.locator("#contextPickerButton")).toContainText("Context");
  await expect(page.locator("#attachmentButton")).toContainText("Images");
  await expect(page.locator("#jumpEarlier")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-mobile.png"),
  });
});

test("adds an existing project and reports handoff failures", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);

  const newProject = page.locator("#newProjectButton");
  await newProject.click();
  const dialog = page.locator("#projectDialog");
  const pathInput = page.locator("#projectPathInput");
  await expect(dialog).toBeVisible();
  await expect(pathInput).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Open or create" }),
  ).toBeVisible();
  expect(projectActions).toEqual([]);

  await page.locator("#projectDialogBrowse").click();
  await expect.poll(() => projectActions).toEqual([{ action: "pick" }]);
  await expect(pathInput).toHaveValue("C:/workspace/picked-project");
  expect(projectActions).toHaveLength(1);

  projectLaunchDelayMs = 900;
  const projectPagePromise = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Open or create" }).click();
  const projectPage = await projectPagePromise;
  await expect(projectPage.getByRole("status")).toContainText(
    "Preparing project in a new tab",
  );
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#projectDialogCancel")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("project-launch-pending-dialog.png"),
  });
  await projectPage.screenshot({
    path: testInfo.outputPath("project-handoff-pending.png"),
  });
  await expect
    .poll(() => projectActions)
    .toContainEqual({
      action: "create",
      path: "C:/workspace/picked-project",
    });
  await expect
    .poll(() => new URL(projectPage.url()).origin)
    .toBe(new URL(handle.url).origin);
  await expect(projectPage.locator("#connectionState")).toHaveClass(
    /is-connected/,
  );
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  await expect(page.locator("#recentProjectsShell")).toBeVisible();
  await expect(page.locator("#projectList")).toContainText("picked-project");
  await page.screenshot({
    path: testInfo.outputPath("project-added-sidebar.png"),
  });
  expect(browserErrors).toEqual([]);
  await projectPage.close();

  projectLaunchDelayMs = 0;
  projectFailureMessage = "Internal launcher detail";
  projectFailureCode = "parent_missing";
  await newProject.click();
  await pathInput.fill("C:/missing-parent/new-project");
  const failedProjectPagePromise = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Open or create" }).click();
  const failedProjectPage = await failedProjectPagePromise;
  await expect.poll(() => failedProjectPage.isClosed()).toBe(true);
  await expect(dialog).toBeVisible();
  await expect(page.locator("#toasts")).toContainText(
    "The parent folder does not exist. Choose an existing location first.",
  );
  projectFailureMessage = undefined;
  projectFailureCode = undefined;
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#menuButton").click();
  await expect(newProject).toBeVisible();
  await newProject.click();
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("project-dialog-mobile.png"),
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(newProject).toBeFocused();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press("Control+,");
  await page.locator('[data-theme-value="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#inspectorClose").click();
  projectLaunchDelayMs = 900;
  await newProject.click();
  await pathInput.fill("C:/workspace/dark-project");
  const darkProjectPagePromise = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Open or create" }).click();
  const darkProjectPage = await darkProjectPagePromise;
  await expect(darkProjectPage.getByRole("status")).toContainText(
    "Preparing project in a new tab",
  );
  const sourceBackground = await page
    .locator("body")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const handoffBackground = await darkProjectPage
    .locator("body")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(handoffBackground).toBe(sourceBackground);
  await darkProjectPage.screenshot({
    path: testInfo.outputPath("project-handoff-pending-dark.png"),
  });
  await expect
    .poll(() => new URL(darkProjectPage.url()).origin)
    .toBe(new URL(handle.url).origin);
  await darkProjectPage.close();
  expect(
    browserErrors.filter((message) => !message.includes("status of 409")),
  ).toEqual([]);
});

test("keeps primary sidebar actions fixed while a long chat list scrolls", async ({
  page,
}, testInfo) => {
  sessionFixtures = Array.from({ length: 44 }, (_, index) => ({
    id: index === 0 ? "e2e-session" : `sidebar-session-${index}`,
    title: index === 0 ? "New Orbit Session" : `Sidebar history ${index + 1}`,
    model: index % 2 === 0 ? "deepseek-v4-pro" : "deepseek-flash",
    updatedAt: new Date(
      Date.parse("2026-08-14T08:00:00.000Z") - index * 60_000,
    ).toISOString(),
  }));
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  await expect(page.locator("#projectChatCount")).toHaveText("44");

  const sidebar = page.locator("#sidebar");
  const chatScroller = page.locator("#projectChatBody");
  const brandBefore = await page.locator(".brand-row").boundingBox();
  const newChatBefore = await page.locator("#newTaskButton").boundingBox();
  expect(brandBefore).not.toBeNull();
  expect(newChatBefore).not.toBeNull();
  await expect
    .poll(() =>
      chatScroller.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await chatScroller.hover();
  await page.mouse.wheel(0, 640);
  await expect
    .poll(() => chatScroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(chatScroller).toHaveClass(/has-scroll-before/);
  await expect(chatScroller).toHaveClass(/has-scroll-after/);
  expect(await sidebar.evaluate((element) => element.scrollTop)).toBe(0);

  const brandAfter = await page.locator(".brand-row").boundingBox();
  const newChatAfter = await page.locator("#newTaskButton").boundingBox();
  expect(
    Math.abs((brandAfter?.y ?? 0) - (brandBefore?.y ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((newChatAfter?.y ?? 0) - (newChatBefore?.y ?? 0)),
  ).toBeLessThanOrEqual(1);

  await chatScroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await chatScroller.focus();
  await page.keyboard.press("PageDown");
  await expect
    .poll(() => chatScroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(chatScroller).toHaveClass(/has-scroll-before/);
  await page.screenshot({
    path: testInfo.outputPath("sidebar-long-chat-list.png"),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#menuButton").click();
  await expect(page.locator("#newTaskButton")).toBeVisible();
  await expect
    .poll(() =>
      chatScroller.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      sidebar.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("sidebar-long-chat-list-mobile.png"),
  });
  await page.locator("#projectToggle").click();
  await expect(chatScroller).toBeHidden();
  const collapsedProjectBounds = await page
    .locator("#projectSection")
    .boundingBox();
  expect(collapsedProjectBounds).not.toBeNull();
  expect(
    collapsedProjectBounds?.height ?? Number.POSITIVE_INFINITY,
  ).toBeLessThanOrEqual(60);
  expect(browserErrors).toEqual([]);
});

test("reviews changes and stages image attachments without layout regressions", async ({
  page,
}) => {
  await page.goto(handle.url);
  await page.getByTestId("changes").click();
  await expect(page.getByTestId("changes-list")).toContainText("src/index.ts");
  await expect(page.getByTestId("changes-list")).toContainText("+new");
  await page.locator("#browserPreviewHide").click();

  await page.getByTestId("attachment-input").setInputFiles({
    name: "screen.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await expect(page.locator(".attachment-card")).toContainText("screen.png");
  await page.route("**/api/attachment?*", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Attachment removal failed" }),
      });
      return;
    }
    await route.continue();
  });
  await page.locator("[data-attachment-remove]").click();
  await expect(page.locator(".attachment-card")).toContainText("screen.png");
  await expect(page.locator(".toast.is-error")).toContainText(
    "Attachment removal failed",
  );
  await page.unroute("**/api/attachment?*");
  await page.locator("[data-attachment-remove]").click();
  await expect(page.locator(".attachment-card")).toHaveCount(0);
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

  await page.locator("#tasksButton").click();
  await expect(page.locator("#agentRunList")).toContainText(
    "reviewer:accessibility",
  );
  await expect(page.locator("#agentRunList")).toContainText("$0.1000 / $0.50");
  await page.locator('[data-agent-action="open-steer"]').click();
  const steering = page.locator('[data-agent-steer-editor="agent_e2e"]');
  await expect(steering).toBeFocused();
  await steering.fill("Also inspect the keyboard focus order.");
  await steering.press("Control+Enter");
  await expect
    .poll(() => steeredAgents)
    .toEqual([
      {
        agentId: "agent_e2e",
        prompt: "Also inspect the keyboard focus order.",
      },
    ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-agent-action="open-steer"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.locator('[data-agent-action="cancel-steer"]').click();
  await page.locator('[data-agent-action="abort"]').click();
  await expect.poll(() => abortedAgents).toEqual(["agent_e2e"]);
  await page.locator('[data-agent-action="resume"]').click();
  await expect
    .poll(() => resumedAgents)
    .toEqual([{ runId: "run_e2e", agentId: "agent_resume" }]);
});

test("attributes concurrent work approvals to the requesting agent", async ({
  page,
}) => {
  await stopOrbitWebUi();
  let pendingApproval: WebUiApprovalSnapshot | undefined = {
    id: "b2a4c5ce-0000-4000-8000-000000000042",
    kind: "change" as const,
    title: "Accept the accessibility review changes?",
    reason: "Review the focused diff before keeping this agent's changes.",
    preview: "@@ -1 +1 @@\n-old label\n+accessible label",
    agentId: "agent_e2e",
    agentRole: "reviewer:accessibility",
    requestedAt: "2026-07-25T00:02:00.000Z",
  };
  const decisions: Array<{ id: string; approved: boolean }> = [];
  handle = await startOrbitWebUi({
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    port: 0,
    open: false,
    getPendingApproval: () => pendingApproval,
    respondToApproval: async (decision) => {
      decisions.push(decision);
      pendingApproval = undefined;
      return { ok: true };
    },
  });

  await page.goto(handle.url);
  const approvalPanel = page.locator("#approvalPanel");
  await expect(approvalPanel).toBeVisible();
  await expect(page.locator("#approvalReason")).toContainText(
    "Requested by reviewer:accessibility",
  );
  await expect(page.locator("#approvalPreview")).toContainText(
    "+accessible label",
  );
  await page.setViewportSize({ width: 900, height: 720 });
  const shortWindowMessageBounds = await page
    .locator("#messageScroll")
    .boundingBox();
  expect(shortWindowMessageBounds).not.toBeNull();
  expect(shortWindowMessageBounds?.height ?? 0).toBeGreaterThanOrEqual(120);
  const shortWindowPreviewBounds = await page
    .locator("#approvalPreview")
    .boundingBox();
  expect(shortWindowPreviewBounds).not.toBeNull();
  expect(
    shortWindowPreviewBounds?.height ?? Number.POSITIVE_INFINITY,
  ).toBeLessThanOrEqual(130);
  await page.setViewportSize({ width: 900, height: 600 });
  await expect
    .poll(async () => {
      const bounds = await page.locator("#messageScroll").boundingBox();
      return bounds?.height ?? 0;
    })
    .toBeGreaterThanOrEqual(96);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const approvalPreviewBounds = await page
    .locator("#approvalPreview")
    .boundingBox();
  expect(approvalPreviewBounds).not.toBeNull();
  expect(
    approvalPreviewBounds?.height ?? Number.POSITIVE_INFINITY,
  ).toBeLessThanOrEqual(129);
  await page.locator("#approveApprovalButton").click();
  await expect
    .poll(() => decisions)
    .toEqual([
      {
        id: "b2a4c5ce-0000-4000-8000-000000000042",
        approved: true,
      },
    ]);
  await expect(approvalPanel).toBeHidden();
});

test("keeps the task center keyboard reachable on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.goto(handle.url);
  await page.getByTestId("tasks").click();
  await expect(page.locator("#tasksPanel")).toBeVisible();
  await expect(page.locator("#taskOverview")).toContainText("Untitled task");
  await expect(page.locator("#taskOverview")).toContainText("Running");
  await expect(page.locator("#taskOverview")).toContainText("1 / 2");
  await expect(page.locator("#taskOverview")).toContainText("balanced");
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
  const runContent = page.locator("#runContent");
  const taskScrollPosition = await runContent.evaluate((element) => {
    element.scrollTop = 140;
    return element.scrollTop;
  });
  expect(taskScrollPosition).toBeGreaterThan(0);
  await page.locator("#activityTab").click();
  const activityScrollPosition = await runContent.evaluate((element) => {
    element.scrollTop = 180;
    return element.scrollTop;
  });
  expect(activityScrollPosition).toBeGreaterThan(0);
  await page.locator("#browserPreviewHide").click();
  await page.locator("#tasksButton").click();
  await expect
    .poll(() => runContent.evaluate((element) => element.scrollTop))
    .toBe(taskScrollPosition);
  await page.locator("#activityTab").click();
  await expect
    .poll(() => runContent.evaluate((element) => element.scrollTop))
    .toBe(activityScrollPosition);
  await page.locator("#tasksTab").click();
  await page.locator("#prompt").fill("Keep this draft while reviewing.");
  await page.locator("#changesTab").click();
  await expect(page.locator("#changesPanel")).toBeVisible();
  await expect(page.locator("#prompt")).toBeEditable();
  await page.locator("#runTab").click();
  await expect
    .poll(() => runContent.evaluate((element) => element.scrollTop))
    .toBe(taskScrollPosition);
  await page.keyboard.press("Control+,");
  await expect(page.locator("#inspector")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  const settingsContent = page.locator("#inspectorContent");
  await settingsContent.evaluate((element) => {
    element.scrollTop = 180;
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("#runPanel")).toBeVisible();
  await expect(page.locator("#prompt")).toHaveValue(
    "Keep this draft while reviewing.",
  );
  await page.keyboard.press("Control+,");
  await expect
    .poll(() => settingsContent.evaluate((element) => element.scrollTop))
    .toBe(180);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => runContent.evaluate((element) => element.scrollTop))
    .toBe(taskScrollPosition);
  await page.locator("#browserPreviewHide").click();
  await expect(page.getByTestId("tasks")).toBeFocused();

  await page.locator("#inspectorButton").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspectorClose")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.locator('[data-settings-target="settingsGeneral"]'),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#inspectorClose")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#inspectorButton")).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#tasksButton").click();
  await expect(page.locator("#taskOverview")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#workbench")).toBeHidden();
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

test("keeps polished settings readable, contained, and keyboard accessible", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  await page.keyboard.press("Control+,");
  await expect(page.locator("#inspectorClose")).toBeFocused();

  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-settings-target="settingsGeneral"]').click();
    await expect(page.locator("#inspector")).toHaveCSS(
      "width",
      `${width > 560 ? 480 : width}px`,
    );
    await expect(page.locator(".setting-row p").first()).toHaveCSS(
      "font-size",
      "12px",
    );
    await expect(page.locator("#customModel")).toHaveCSS("font-size", "13px");
    const language = await page.locator("#languageOptions").boundingBox();
    const general = await page.locator("#settingsGeneral").boundingBox();
    expect(language!.width).toBeCloseTo(general!.width, 0);
    await page.locator("#customModel").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#customModel")).toBeFocused();
    await expect(page.locator("#customModel")).toHaveCSS(
      "outline-style",
      "solid",
    );
    await expect(page.locator("#customModel")).toHaveCSS(
      "outline-width",
      "2px",
    );
    await page.locator('[data-settings-target="settingsCapabilities"]').click();
    const index = await page.locator(".settings-index").boundingBox();
    const section = await page.locator("#settingsCapabilities").boundingBox();
    expect(section!.y).toBeGreaterThanOrEqual(index!.y + index!.height);
    expect(
      await page
        .locator("#inspectorContent")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator('[data-settings-target="settingsGeneral"]').click();
    await page.screenshot({
      path: testInfo.outputPath(`settings-polish-${width}.png`),
      animations: "disabled",
    });
  }

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".inspector-header h2")).toHaveCSS(
    "color",
    "rgb(241, 245, 246)",
  );
  await page.screenshot({
    path: testInfo.outputPath("settings-polish-dark.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("#prompt")).toBeFocused();
  await expect(page.locator(".message-column")).toHaveCSS("gap", "16px");
  await expect(page.locator(".message-actions").last()).toHaveCSS(
    "opacity",
    "1",
  );
  expect(browserErrors).toEqual([]);
});

test("keeps timeline navigation above an expanding composer and skips hidden buttons", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  const scroll = page.locator("#messageScroll");
  const latest = page.locator("#jumpBottom");
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page
      .locator("#prompt")
      .fill(
        Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`).join(
          "\n",
        ),
      );
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight / 2;
    });
    await expect(latest).toHaveClass(/is-visible/);
    await expect
      .poll(async () => {
        const button = await latest.boundingBox();
        const composer = await page.locator("#composerDock").boundingBox();
        return composer!.y - button!.y - button!.height;
      })
      .toBeGreaterThanOrEqual(8);
    await page.screenshot({
      path: testInfo.outputPath(`timeline-navigation-${width}.png`),
      animations: "disabled",
    });
    if (width === 390) {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: testInfo.outputPath("timeline-navigation-dark.png"),
        animations: "disabled",
      });
      await page.emulateMedia({ colorScheme: "light" });
    }
    await latest.click();
    await expect(latest).not.toHaveClass(/is-visible/);
    await expect(latest).toHaveCSS("visibility", "hidden");
    await latest.evaluate((element) => element.focus());
    await expect(latest).not.toBeFocused();
    await page.locator("#prompt").fill("");
  }
  expect(browserErrors).toEqual([]);
});

test("tracks the settings section and moves keyboard focus to its content", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(handle.url);
  await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
  await page.keyboard.press("Control+,");
  const general = page.locator('[data-settings-target="settingsGeneral"]');
  const capabilities = page.locator(
    '[data-settings-target="settingsCapabilities"]',
  );
  const appearance = page.locator(
    '[data-settings-target="settingsAppearance"]',
  );
  await expect(general).toHaveAttribute("aria-current", "location");
  await capabilities.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#settingsCapabilities")).toBeFocused();
  await expect(capabilities).toHaveAttribute("aria-current", "location");
  await page.keyboard.press("Tab");
  await expect(page.locator("#skillsEnabled")).toBeFocused();
  await page.locator("#inspectorContent").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(appearance).toHaveAttribute("aria-current", "location");
  await expect(capabilities).not.toHaveAttribute("aria-current", "location");
  await general.click();
  await expect(page.locator("#settingsGeneral")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-language-value="en"]')).toBeFocused();
  eventBus.emitEvent("ui_turn_started", {
    turnId: "settings-navigation-busy",
    source: "terminal",
    prompt: "Inspect settings",
  });
  await expect(page.locator("#customModel")).toBeDisabled();
  await expect(appearance).toBeEnabled();
  await appearance.click();
  await expect(page.locator("#settingsAppearance")).toBeFocused();
  eventBus.emitEvent("ui_turn_completed", {
    turnId: "settings-navigation-busy",
    source: "terminal",
    status: "completed",
  });
  await expect(page.locator("#customModel")).toBeEnabled();
  expect(browserErrors).toEqual([]);
});

test("creates a workflow from settings and exposes it as a slash command", async ({
  page,
}, testInfo) => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-workflow-e2e-"));
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
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

    await page.keyboard.press("Control+,");
    await page.locator("#addCapabilityButton").click();
    await page.locator("#capabilityTemplate").selectOption("mcm");
    await expect(page.locator("#capabilityScope")).toBeHidden();
    await expect(page.locator("#capabilityDescription")).toHaveAttribute(
      "maxlength",
      "240",
    );
    await expect(page.locator("#capabilityArgumentHint")).toHaveValue(
      "<problem.pdf> <data.csv> [requirements]",
    );
    await page.locator("#capabilityName").fill("mcm-draft");
    await page
      .locator("#capabilityDescription")
      .fill("Draft a mathematical modeling paper");
    await page
      .locator("#capabilityInstructions")
      .fill("Analyze the supplied data and draft a structured paper.");
    await page
      .locator("#capabilityArgumentHint")
      .fill("<brief.pdf> <data.csv>");
    await expect(page.locator("#capabilityPreview")).toHaveText(
      "/mcm-draft <brief.pdf> <data.csv>",
    );
    await expect(page.locator("#capabilityStages")).toBeHidden();
    await page.locator("#capabilityStagesDetails summary").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#capabilityStages")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator("#capabilityStages")).toBeFocused();
    await expect(page.locator("#formatCapabilityStages")).toBeDisabled();
    await page.locator("#capabilityStages").fill("not-json");
    await page.locator("#createCapabilityButton").click();
    await expect(page.locator("#capabilityStages")).toBeFocused();
    await expect(page.locator("#capabilityFormError")).toBeVisible();
    await expect(page.locator("#capabilityStages")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    const verifyStage = {
      id: "verify",
      title: "Verify",
      prompt: "Run checks",
      verification: true,
    };
    for (const [invalid, message] of [
      [[{ ...verifyStage, title: "" }], "Stage 1: title is required"],
      [[{ ...verifyStage, verification: false }], "Stage 1: add an artifact"],
      [[verifyStage, verifyStage], "Stage 2: id must be unique"],
      [
        [{ ...verifyStage, artifacts: ["../escape"] }],
        "Stage 1: artifact paths",
      ],
      [
        [{ ...verifyStage, skills: ["missing-stage-skill"] }],
        "Stage 1: These Skills were not found",
      ],
    ] as const) {
      await page.locator("#capabilityStages").fill(JSON.stringify(invalid));
      await page.locator("#capabilityStagesDetails summary").click();
      await page.locator("#createCapabilityButton").click();
      await expect(page.locator("#capabilityStages")).toBeFocused();
      await expect(page.locator("#capabilityFormError")).toContainText(message);
    }
    await page.locator("#capabilityStages").fill(
      JSON.stringify([
        {
          id: "verify",
          title: "Verify",
          prompt: "Run checks",
          verification: true,
        },
      ]),
    );
    await expect(page.locator("#capabilityFormError")).toBeHidden();
    await expect(page.locator("#capabilityStages")).toHaveAttribute(
      "aria-describedby",
      "capabilityStagesHint capabilityStagesStatus",
    );
    await expect(page.locator("#capabilityStagesStatus")).toHaveText(
      "1 stage ready",
    );
    await page.locator("#formatCapabilityStages").click();
    await expect(page.locator("#capabilityStages")).toHaveValue(
      JSON.stringify([verifyStage], null, 2),
    );
    await expect(page.locator("#capabilityStages")).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(
      (await page.locator("#capabilityStages").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(148);
    await page.screenshot({
      path: testInfo.outputPath("workflow-creator-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#capabilityStages").scrollIntoViewIfNeeded();
    expect(
      (await page.locator("#capabilityStages").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(148);
    await page.screenshot({
      path: testInfo.outputPath("workflow-creator-narrow.png"),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: testInfo.outputPath("workflow-creator-narrow-dark.png"),
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.locator("#createCapabilityButton").click();
    await expect(page.locator("#workflowList")).toContainText("mcm-draft");
    await expect(page.locator("#workflowList")).toContainText("1 stage");
    await expect(page.locator("#workflowList")).not.toContainText("1 stages");
    expect(
      readFileSync(join(cwd, ".orbit/commands/mcm-draft.md"), "utf8"),
    ).toContain("verification: true");
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.locator("#inspectorClose").click();
    const composer = page.getByTestId("composer-input");
    await composer.fill("/mcm");
    await expect(
      page.locator(".slash-command-option").filter({ hasText: "/mcm-draft" }),
    ).toHaveCount(1);
    expect(browserErrors).toEqual([]);
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});

for (const language of ["zh", "zh-TW"] as const) {
  test(`localizes workflow editing and resets stage drafts in ${language}`, async ({
    page,
  }, testInfo) => {
    await stopOrbitWebUi();
    try {
      handle = await startOrbitWebUi({
        cwd: process.cwd(),
        config: { ...structuredClone(DEFAULT_CONFIG), language },
        port: 0,
        open: false,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(handle.url);
      await page.keyboard.press("Control+,");
      await page.locator("#addCapabilityButton").click();
      await page.locator("#capabilityTemplate").selectOption("mcm");
      await page.locator("#capabilityStagesDetails summary").click();
      await expect(
        page.locator("#capabilityStagesDetails summary"),
      ).toContainText(language === "zh" ? "结构化阶段" : "結構化階段");
      await page
        .locator("#capabilityStages")
        .fill('[{"id":"verify","title":"检查","prompt":"运行检查"}]');
      await page.locator("#formatCapabilityStages").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#capabilityStages")).toBeFocused();
      await expect(page.locator("#capabilityFormError")).toContainText(
        language === "zh" ? "阶段 1：请添加产物" : "階段 1：請新增產物",
      );
      await page
        .locator("#capabilityStages")
        .fill(
          '[{"id":"verify","title":"检查","prompt":"运行检查","verification":true}]',
        );
      await page.locator("#formatCapabilityStages").click();
      await expect(page.locator("#capabilityStagesStatus")).toHaveText(
        language === "zh" ? "1 个阶段已就绪" : "1 個階段已就緒",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`workflow-${language}-narrow.png`),
      });
      await page.locator("#cancelCapabilityButton").click();
      await page.locator("#addCapabilityButton").click();
      await page.locator("#capabilityTemplate").selectOption("mcm");
      await expect(page.locator("#capabilityStages")).toBeHidden();
      await page.locator("#capabilityStagesDetails summary").click();
      await expect(page.locator("#capabilityStages")).toHaveValue("");
      await expect(page.locator("#formatCapabilityStages")).toBeDisabled();
      await expect(page.locator("#capabilityFormError")).toBeHidden();
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
      await stopOrbitWebUi();
    }
  });
}

test("enables unrestricted Full Access from settings across desktop and narrow layouts", async ({
  page,
}, testInfo) => {
  const config = structuredClone(DEFAULT_CONFIG);
  const settingsPatches: Array<{ permissionMode?: string }> = [];
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await stopOrbitWebUi();
  try {
    handle = await startOrbitWebUi({
      cwd: process.cwd(),
      config,
      port: 0,
      open: false,
      updateSettings: async (patch) => {
        settingsPatches.push(patch);
        if (patch.permissionMode) {
          return applyPermissionModePreset(config, patch.permissionMode);
        }
        return { ok: true };
      },
    });
    await page.goto(handle.url);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);

    await page.keyboard.press("Control+,");
    const fullAccessButton = page.locator('[data-mode="auto"]');
    await fullAccessButton.focus();
    await expect(fullAccessButton).toBeFocused();
    await fullAccessButton.press("Enter");

    const fullAccessDialog = page.getByRole("alertdialog", {
      name: "Grant unrestricted Full Access?",
    });
    await expect(fullAccessDialog).toBeVisible();
    await expect(page.locator("#appShell")).toHaveAttribute("inert", "");
    await expect(page.locator("#fullAccessConfirm")).toBeFocused();
    await expect(fullAccessDialog).toContainText(
      "permission policy will approve every enabled tool action without asking or requesting post-write review",
    );
    await expect(fullAccessDialog).toContainText("local/private network calls");
    await expect(fullAccessDialog).toContainText(
      "child commands inherit the Orbit process environment",
    );
    expect(settingsPatches).not.toContainEqual({ permissionMode: "auto" });
    await page.screenshot({
      path: testInfo.outputPath("full-access-confirmation-desktop.png"),
    });

    await page.keyboard.press("Escape");
    await expect(fullAccessDialog).toBeHidden();
    await expect(page.locator("#appShell")).not.toHaveAttribute("inert", "");
    await expect(fullAccessButton).toBeFocused();
    await expect(fullAccessButton).toHaveAttribute("aria-pressed", "false");

    await fullAccessButton.press("Enter");
    await page.locator("#fullAccessConfirm").click();

    await expect(page.locator("#appShell")).not.toHaveAttribute("inert", "");
    await expect(fullAccessButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#permissionSummary")).toContainText(
      "Unrestricted Full Access is on",
    );
    await expect(page.locator("#permissionSummary")).toContainText(
      "permission policy no longer blocks or reviews dangerous, protected, opaque, local-network, or outside-workspace actions",
    );
    await expect(page.locator("#permissionSummary")).toContainText(
      "host-account permissions",
    );
    await expect(page.locator("#permissionSummary")).toContainText(
      "inherit Orbit's process environment",
    );
    await expect(page.locator("#permissionSummary")).toContainText(
      "Intermediate iteration checkpoints continue automatically without asking",
    );
    await expect(page.locator("#agentMaxIterations")).toHaveValue("200");
    await expect(page.locator("#permissionSummary")).toContainText(
      "project hooks, verification contracts",
    );
    await expect(page.locator("#permissionSummary")).toHaveClass(
      /is-full-access/,
    );
    await expect
      .poll(() => settingsPatches.at(-1))
      .toMatchObject({
        permissionMode: "auto",
      });
    expect(config.permissions).toMatchObject({
      mode: "auto",
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
      blockDangerousCommands: false,
      protectSecrets: false,
    });
    await page.screenshot({
      path: testInfo.outputPath("unrestricted-full-access-desktop.png"),
    });

    const normalButton = page.locator('[data-mode="normal"]');
    await normalButton.click();
    await expect(normalButton).toHaveAttribute("aria-pressed", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    await fullAccessButton.click();
    await expect(fullAccessDialog).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("full-access-confirmation-narrow.png"),
    });
    await page.locator("#fullAccessConfirm").click();
    await expect(fullAccessDialog).toBeHidden();
    await expect(page.locator("#appShell")).not.toHaveAttribute("inert", "");
    await expect(fullAccessButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#permissionSummary")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("unrestricted-full-access-narrow.png"),
    });
    expect(browserErrors).toEqual([]);
  } finally {
    await stopOrbitWebUi();
  }
});

test("creates a complete versioned Skill from settings", async ({
  page,
}, testInfo) => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-skill-e2e-"));
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
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

    await page.keyboard.press("Control+,");
    await page.locator("#addCapabilityButton").click();
    await expect(page.locator("#capabilityScope")).toBeVisible();
    await page.locator("#capabilityScope").selectOption("versioned");
    await page.locator("#capabilityName").fill("data-review");
    await page
      .locator("#capabilityDescription")
      .fill("Review structured data and report anomalies.");
    await page
      .locator("#capabilityInstructions")
      .fill(
        "Inspect the supplied data, validate assumptions, and report evidence.",
      );
    await page.screenshot({
      path: testInfo.outputPath("versioned-skill-form.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#capabilityScope")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator("#createCapabilityButton").click();
    await expect(page.locator("#skillList")).toContainText("data-review");

    const skillRoot = join(cwd, ".agents", "skills", "data-review");
    expect(existsSync(join(skillRoot, "SKILL.md"))).toBe(true);
    for (const directory of ["agents", "references", "scripts", "assets"]) {
      expect(existsSync(join(skillRoot, directory))).toBe(true);
    }
    expect(browserErrors).toEqual([]);
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("keeps the empty workspace polished in light, dark, and narrow layouts", async ({
  page,
}) => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-empty-e2e-"));
  await stopOrbitWebUi();
  try {
    handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      updateSettings: async () => ({ ok: true }),
      loop: {
        getHistory: () => [],
        getSessions: () => [],
        getRelevantFiles: () => [],
        getSessionId: () => "empty-e2e-session",
      },
    });
    await page.goto(handle.url);
    const heading = page.locator("#emptyState h1");
    await expect(heading).toBeVisible();
    const desktopLineCount = await heading.evaluate((element) => {
      const lineHeight = Number.parseFloat(
        getComputedStyle(element).lineHeight,
      );
      return Math.round(element.getBoundingClientRect().height / lineHeight);
    });
    expect(desktopLineCount).toBe(1);
    const composerHeight = await page
      .getByTestId("composer-input")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(composerHeight).toBeGreaterThanOrEqual(42);
    expect(composerHeight).toBeLessThanOrEqual(58);

    await page.keyboard.press("Control+,");
    const customModel = page.locator("#customModel");
    const applyModel = page.locator("#applyModel");
    await expect(applyModel).toBeDisabled();
    await customModel.fill("orbit-e2e-model");
    await expect(applyModel).toBeEnabled();
    await customModel.press("Enter");
    await expect(customModel).toHaveValue("");
    await expect(applyModel).toBeDisabled();
    await page.locator('[data-settings-target="settingsCapabilities"]').click();
    await expect(page.locator("#settingsCapabilities")).toBeInViewport();
    await page.locator('[data-settings-target="settingsAppearance"]').click();
    await expect(page.locator("#settingsAppearance")).toBeInViewport();
    await page.locator('[data-theme-value="dark"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator("#inspectorClose").click();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await page.getByTestId("composer-input").focus();
    await expect(page.getByTestId("composer-input")).toBeFocused();
    await page.keyboard.press("Control+,");
    await expect
      .poll(() =>
        page
          .locator("#languageOptions")
          .evaluate(
            (element) =>
              getComputedStyle(element).gridTemplateColumns.split(" ").length,
          ),
      )
      .toBe(3);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expect(heading).toBeVisible();
    await expect(page.locator("#settingsAppearance")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await page.locator("#settingsAppearance").scrollIntoViewIfNeeded();
    await expect(page.locator('[data-theme-value="dark"]')).toBeVisible();

    await page.emulateMedia({
      reducedMotion: "reduce",
      forcedColors: "active",
    });
    await expect(page.locator("#inspector")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    await expect(page.locator("#settingsPanel")).toBeVisible();
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("restores a Skill toggle after a failed save and rejects missing workflow Skills", async ({
  page,
}) => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-skill-e2e-"));
  const skillDirectory = join(cwd, ".agents", "skills", "audit-skill");
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(
    join(skillDirectory, "SKILL.md"),
    [
      "---",
      "name: audit-skill",
      "description: Audit a change before release.",
      "---",
      "",
      "# Audit Skill",
      "",
      "Inspect the change and report evidence.",
      "",
    ].join("\n"),
    "utf8",
  );
  await stopOrbitWebUi();
  try {
    handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      updateSettings: async () => ({
        ok: false,
        message: "Simulated settings failure",
      }),
    });
    await page.goto(handle.url);
    // Do not publish synthetic Orbit events until the browser has completed
    // its authenticated SSE handshake.  Sending earlier makes the test depend
    // on an incidental scheduling window and can lose the first event.
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
    await page.keyboard.press("Control+,");

    const skillRow = page
      .locator(".skill-row")
      .filter({ hasText: "audit-skill" });
    const skillToggle = skillRow.locator('input[type="checkbox"]');
    await expect(skillToggle).toBeChecked();
    await skillRow.locator("label.switch").click();
    await expect(page.locator(".toast.is-error")).toContainText(
      "Simulated settings failure",
    );
    await expect(skillToggle).toBeChecked();

    await page.locator("#addCapabilityButton").click();
    await page.locator('[data-capability-kind="workflow"]').click();
    await page.locator("#capabilityName").fill("invalid-workflow");
    await page
      .locator("#capabilityDescription")
      .fill("Exercise composed Skill validation.");
    await page
      .locator("#capabilityInstructions")
      .fill("Run the configured Skill and summarize its findings.");
    await page.locator("#capabilitySkills").fill("missing-skill");
    await page.locator("#createCapabilityButton").click();
    await expect(page.locator("#capabilityFormError")).toContainText(
      "missing-skill",
    );
    await expect(page.locator("#capabilityFormError")).toBeVisible();
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("shows draft review gates and activation explanations at desktop and narrow widths", async ({
  page,
}, testInfo) => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-skill-review-e2e-"));
  const dir = join(cwd, ".agents", "skills", "draft-review");
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    "---\nname: draft-review\ndescription: Review code before reuse\n---\nReview the procedure.",
  );
  const policy = join(dir, "agents", "openai.yaml");
  writeFileSync(
    policy,
    "policy:\n  review_status: draft\n  allow_implicit_invocation: false\n",
  );
  const config = structuredClone(DEFAULT_CONFIG);
  config.skills.directories = [".agents/skills"];
  config.language = "en";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stopOrbitWebUi();
  try {
    handle = await startOrbitWebUi({
      cwd,
      config,
      port: 0,
      open: false,
      updateSettings: async (patch) => {
        if (patch.skillsDisabled) config.skills.disabled = patch.skillsDisabled;
        return { ok: true };
      },
    });
    await page.goto(handle.url);
    await page.keyboard.press("Control+,");
    const row = page.locator(".skill-row").filter({ hasText: "draft-review" });
    await expect(row.locator(".skill-review-badge")).toHaveText(
      "Review required",
    );
    await expect(row.locator(".skill-review-note")).toBeVisible();
    await expect(row.locator(".skill-review-note")).toContainText(
      "agents/openai.yaml",
    );
    await expect(row.locator(".skill-use")).toBeDisabled();
    await expect(row.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator("#skillSummary")).toHaveText(
      "0 ready · 1 discovered",
    );
    await page.locator("#refreshSkills").click();
    await expect(row.locator(".skill-use")).toBeDisabled();
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await row.scrollIntoViewIfNeeded();
      await expect(row).toContainText("policy.review_status");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`skill-draft-${viewport.width}.png`),
      });
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: testInfo.outputPath("skill-draft-narrow-dark.png"),
    });
    await page.emulateMedia({ colorScheme: "light" });
    writeFileSync(
      policy,
      "policy:\n  review_status: approved\n  allow_implicit_invocation: false\n",
    );
    await page.locator("#refreshSkills").focus();
    await page.keyboard.press("Enter");
    await expect(row.locator(".skill-use")).toBeEnabled();
    await expect(row.locator(".skill-review-badge")).toHaveCount(0);
    await expect(row.locator(".skill-review-note")).toHaveCount(0);
    await expect(row.locator('input[type="checkbox"]')).toBeChecked();
    await expect(page.locator("#skillSummary")).toHaveText(
      "1 ready · 1 discovered",
    );
    await row.locator("label.switch").click();
    await expect(row.locator(".skill-use")).toBeDisabled();
    await expect(row.locator('input[type="checkbox"]')).not.toBeChecked();
    await row.locator("label.switch").click();
    await expect(row.locator(".skill-use")).toBeEnabled();
    await row.locator(".skill-use").click();
    await expect(page.locator("#prompt")).toHaveValue(/\$draft-review/);
    eventBus.emitEvent("skill_activated", {
      name: "draft-review",
      activation: "auto",
      activationReason: "metadata-match",
      matchedTerms: 3,
      loadedBytes: 512,
      truncated: true,
      truncationReason: "context-budget",
    });
    await page.locator("#tasksButton").click();
    await page.locator("#activityTab").click();
    await expect(
      page.getByText(/\$draft-review · metadata match \(3\).*truncated/),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("skill-activation-narrow.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    await page.setViewportSize({ width: 1280, height: 720 });
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("preserves rapid consecutive Skill toggles without losing an update", async ({
  page,
}) => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-skill-race-e2e-"));
  for (const name of ["audit-one", "audit-two"]) {
    const skillDirectory = join(cwd, ".agents", "skills", name);
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(
      join(skillDirectory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} workflow\n---\nInspect carefully.\n`,
      "utf8",
    );
  }
  const config = structuredClone(DEFAULT_CONFIG);
  const savedDisabled: string[][] = [];
  await stopOrbitWebUi();
  try {
    handle = await startOrbitWebUi({
      cwd,
      config,
      port: 0,
      open: false,
      updateSettings: async (patch) => {
        if (patch.skillsDisabled) {
          savedDisabled.push([...patch.skillsDisabled]);
          config.skills.disabled = [...patch.skillsDisabled];
        }
        return { ok: true };
      },
    });
    await page.goto(handle.url);
    await page.keyboard.press("Control+,");

    const first = page
      .locator(".skill-row")
      .filter({ hasText: "audit-one" })
      .locator("label.switch");
    const second = page
      .locator(".skill-row")
      .filter({ hasText: "audit-two" })
      .locator("label.switch");
    await first.click();
    await second.click();

    await expect.poll(() => savedDisabled).toHaveLength(2);
    expect(new Set(savedDisabled.at(-1))).toEqual(
      new Set(["audit-one", "audit-two"]),
    );
    await expect(
      page
        .locator(".skill-row")
        .filter({ hasText: "audit-one" })
        .locator('input[type="checkbox"]'),
    ).not.toBeChecked();
    await expect(
      page
        .locator(".skill-row")
        .filter({ hasText: "audit-two" })
        .locator('input[type="checkbox"]'),
    ).not.toBeChecked();
    const disabledUseButton = page
      .locator(".skill-row")
      .filter({ hasText: "audit-one" })
      .locator(".skill-use");
    await expect(disabledUseButton).toBeDisabled();

    eventBus.emitEvent("ui_turn_started", {
      turnId: "skill-busy-cycle",
      source: "terminal",
      prompt: "exercise busy state",
    });
    await expect(page.getByTestId("orbit-app")).toHaveClass(/is-busy/);
    eventBus.emitEvent("ui_turn_completed", {
      turnId: "skill-busy-cycle",
      source: "terminal",
      status: "completed",
    });
    await expect(page.getByTestId("orbit-app")).not.toHaveClass(/is-busy/);
    await expect(disabledUseButton).toBeDisabled();
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});
