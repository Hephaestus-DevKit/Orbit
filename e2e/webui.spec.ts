import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
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
      getHistory: () =>
        Array.from({ length: 100 }, (_, index) => ({
          id: `history-${index}`,
          role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
          createdAt: new Date(
            Date.parse("2026-07-19T00:00:00.000Z") + index * 60_000,
          ).toISOString(),
          metadata:
            index % 2 === 0 ? undefined : { model: "deepseek-v4-flash" },
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
  }
  await expect(page.locator("#jumpEarlier")).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-mobile.png"),
  });
});

test("reviews changes and stages image attachments without layout regressions", async ({
  page,
}) => {
  await page.goto(handle.url);
  await page.getByTestId("changes").click();
  await expect(page.getByTestId("changes-list")).toContainText("src/index.ts");
  await expect(page.getByTestId("changes-list")).toContainText("+new");
  await page.locator("#inspectorClose").click();

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
    await page.locator("#capabilityTemplate").selectOption("mcm");
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

    await page.locator("#inspectorButton").click();
    await page.locator("#settingsTab").click();
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
    await page.locator("#inspectorButton").click();
    await page.locator("#settingsTab").click();

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
    await page.locator("#inspectorButton").click();
    await page.locator("#settingsTab").click();

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
