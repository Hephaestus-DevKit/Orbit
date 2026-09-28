import { expect, test } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import {
  startOrbitWebUi,
  stopOrbitWebUi,
} from "../packages/cli/src/runtime/webui/WebUiServer.js";
import { eventBus } from "../packages/core/dist/index.js";

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`rejects reserved scaffold names with accessible feedback in ${language}`, async ({
    page,
  }, testInfo) => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-scaffold-"));
    const config = structuredClone(DEFAULT_CONFIG);
    config.language = language;
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/capability")
        requests.push(request.method());
    });
    try {
      const handle = await startOrbitWebUi({
        cwd,
        config,
        port: 0,
        open: false,
      });
      await page.goto(handle.url);
      await expect(page.locator("#connectionState")).toHaveClass(
        /is-connected/,
      );
      await page.keyboard.press("Control+,");
      await page.locator("#addCapabilityButton").click();
      await page
        .locator("#capabilityDescription")
        .fill("Review source changes.");
      await page
        .locator("#capabilityInstructions")
        .fill("Inspect the diff and report findings.");
      for (const [width, kind, name] of [
        [1280, "skill", "CON"],
        [390, "workflow", "lpt9"],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator(`[data-capability-kind="${kind}"]`).click();
        await page.locator("#capabilityName").fill(name);
        await page.locator("#createCapabilityButton").focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("#capabilityName")).toBeFocused();
        await expect(page.locator("#capabilityName")).toHaveAttribute(
          "aria-invalid",
          "true",
        );
        await expect(page.locator("#capabilityFormError")).toContainText(
          language === "en"
            ? "reserved by Windows"
            : language === "zh"
              ? "Windows 保留名称"
              : "Windows 保留名稱",
        );
        await expect(page.locator("#capabilityFormError")).toBeInViewport({
          ratio: 1,
        });
        expect(
          await page
            .locator("#capabilityName")
            .evaluate((field) => field.nextElementSibling?.id),
        ).toBe("capabilityFormError");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`scaffold-name-${language}-${width}.png`),
        });
        await page.locator("#capabilityName").fill("portable-review");
        await expect(page.locator("#capabilityFormError")).toBeHidden();
        await expect(page.locator("#capabilityName")).not.toHaveAttribute(
          "aria-invalid",
          "true",
        );
      }
      expect(requests).toEqual([]);
      expect(existsSync(join(cwd, ".orbit", "skills", "con"))).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await stopOrbitWebUi();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

for (const language of ["en", "zh", "zh-TW"] as const) {
  test(`reflects current Skill policies and workflow dependencies in ${language}`, async ({
    page,
  }, testInfo) => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-dependencies-"));
    const config = structuredClone(DEFAULT_CONFIG);
    config.language = language;
    config.skills.directories = [".agents/skills"];
    config.skills.activation = "explicit";
    config.skills.disabled = ["not-installed"];
    const skillRoot = join(cwd, ".agents", "skills", "review");
    mkdirSync(join(skillRoot, "agents"), { recursive: true });
    writeFileSync(
      join(skillRoot, "SKILL.md"),
      "---\nname: review\ndescription: Review code changes\n---\nReview the code.",
    );
    const policy = join(skillRoot, "agents", "openai.yaml");
    const presentation =
      "interface:\n  default_prompt: Review the pending changes.\npolicy:\n  allow_implicit_invocation: false\n  review_status: ";
    writeFileSync(policy, presentation + "draft\n");
    const commands = join(cwd, ".orbit", "commands");
    mkdirSync(commands, { recursive: true });
    writeFileSync(
      join(commands, "needs-review.md"),
      "---\ndescription: Stage-only dependency\nstages:\n  - id: verify\n    title: Verify\n    prompt: Review the change\n    skills: [review]\n    verification: true\n---\nReview $ARGUMENTS",
    );
    writeFileSync(
      join(commands, "missing.md"),
      "---\ndescription: Missing dependency\nskills: [missing-skill]\n---\nReview $ARGUMENTS",
    );
    writeFileSync(
      join(commands, "plain.md"),
      "---\ndescription: No Skill required\n---\nSummarize $ARGUMENTS",
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const handle = await startOrbitWebUi({
        cwd,
        config,
        port: 0,
        open: false,
        updateSettings: async (patch) => {
          if (patch.skillsDisabled)
            config.skills.disabled = patch.skillsDisabled;
          if (patch.skillsMaxActive !== undefined)
            config.skills.maxActive = patch.skillsMaxActive;
          if (patch.skillsEnabled !== undefined)
            config.skills.enabled = patch.skillsEnabled;
          return { ok: true };
        },
      });
      await page.goto(handle.url);
      await expect(page.locator("#connectionState")).toHaveClass(
        /is-connected/,
      );
      await page.keyboard.press("Control+,");
      const dependent = page
        .locator(".workflow-row")
        .filter({ hasText: "/needs-review" });
      const missing = page
        .locator(".workflow-row")
        .filter({ hasText: "/missing" });
      const plain = page.locator(".workflow-row").filter({ hasText: "/plain" });
      await expect(dependent.locator(".skill-use")).toBeDisabled();
      await expect(
        dependent.locator(".workflow-dependency-note"),
      ).toContainText(
        language === "en"
          ? "Skills pending review"
          : language === "zh"
            ? "待审核"
            : "待審核",
      );
      await expect(missing.locator(".skill-use")).toBeDisabled();
      await expect(missing).toContainText("$missing-skill");
      await expect(plain.locator(".skill-use")).toBeEnabled();
      await expect(page.locator("#skillDiagnostics")).toBeEmpty();
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await dependent.scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`dependencies-${language}-${width}.png`),
        });
      }
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({
        path: testInfo.outputPath(`dependencies-${language}-dark.png`),
      });
      await page.emulateMedia({ colorScheme: "light" });
      const downloadEvent = page.waitForEvent("download");
      await page.locator("#exportCapabilityCatalog").click();
      const download = await downloadEvent;
      const manifest = JSON.parse(
        readFileSync((await download.path())!, "utf8"),
      );
      expect(manifest.skills[0]).toMatchObject({
        reviewStatus: "draft",
        allowImplicitInvocation: false,
      });
      expect(
        manifest.workflows.find(
          (entry: { name: string }) => entry.name === "needs-review",
        ),
      ).toMatchObject({
        stageCount: 1,
        requiredSkills: ["review"],
        dependencyProblems: [{ name: "review", reason: "draft" }],
      });
      writeFileSync(policy, presentation + "approved\n");
      await page.locator("#refreshSkills").click();
      await expect(dependent.locator(".skill-use")).toBeEnabled();
      await expect(dependent.locator(".workflow-dependency-note")).toHaveCount(
        0,
      );
      await dependent.locator(".skill-use").click();
      await expect(page.locator("#prompt")).toHaveValue("/needs-review ");
      await expect(page.locator("#prompt")).toBeFocused();
      await page.keyboard.press("Control+,");
      const skillRow = page
        .locator(".skill-row")
        .filter({ hasText: "$review" });
      await skillRow.locator(".skill-use").click();
      await expect(page.locator("#prompt")).toHaveValue(
        "$review\nReview the pending changes.",
      );
      await expect(page.locator("#prompt")).toBeFocused();
      await page.keyboard.press("Control+,");
      await skillRow.locator("label.switch").click();
      await expect(
        dependent.locator(".workflow-dependency-note"),
      ).toContainText(
        language === "en"
          ? "Disabled Skills"
          : language === "zh"
            ? "已禁用"
            : "已停用",
      );
      expect(config.skills.disabled).toEqual(["not-installed", "review"]);
      await skillRow.locator("label.switch").click();
      await expect(dependent.locator(".skill-use")).toBeEnabled();
      await page.locator("#skillsMaxActive").fill("0");
      await page.locator("#skillsMaxActive").press("Tab");
      await expect(skillRow.locator(".skill-use")).toBeDisabled();
      await expect(dependent.locator(".skill-use")).toBeDisabled();
      await expect(plain.locator(".skill-use")).toBeEnabled();
      await expect(page.locator("#skillSummary")).toContainText(
        language === "en"
          ? "increase the active limit"
          : language === "zh"
            ? "提高同时激活上限"
            : "提高同時啟用上限",
      );
      await page.locator("#skillsMaxActive").fill("3");
      await page.locator("#skillsMaxActive").press("Tab");
      await expect(dependent.locator(".skill-use")).toBeEnabled();
      await page.locator("label.switch:has(#skillsEnabled)").click();
      await expect(dependent.locator(".skill-use")).toBeDisabled();
      await expect(plain.locator(".skill-use")).toBeEnabled();
      await page.locator("label.switch:has(#skillsEnabled)").click();
      await expect(dependent.locator(".skill-use")).toBeEnabled();
      expect(errors).toEqual([]);
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
      await stopOrbitWebUi();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

for (const saved of [false, true]) {
  test(`preserves the correct Skill toggle after catalog failure when saved=${saved}`, async ({
    page,
  }) => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-skill-offline-"));
    const config = structuredClone(DEFAULT_CONFIG);
    config.skills.directories = [".agents/skills"];
    const dir = join(cwd, ".agents", "skills", "review");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: review\ndescription: Review code\n---\nReview the code.",
    );
    try {
      const handle = await startOrbitWebUi({
        cwd,
        config,
        port: 0,
        open: false,
        updateSettings: async (patch) => {
          if (saved && patch.skillsDisabled)
            config.skills.disabled = patch.skillsDisabled;
          return { ok: saved, message: saved ? undefined : "Save failed" };
        },
      });
      await page.goto(handle.url);
      await expect(page.locator("#connectionState")).toHaveClass(
        /is-connected/,
      );
      await page.keyboard.press("Control+,");
      const row = page.locator(".skill-row").filter({ hasText: "$review" });
      await expect(row.locator("input")).toBeChecked();
      await page.route("**/api/skills", (route) =>
        route.fulfill({ status: 503, json: { message: "Catalog offline" } }),
      );
      await row.locator("label.switch").click();
      await expect(page.locator(".toast.is-error")).toContainText(
        saved ? "Catalog offline" : "Save failed",
      );
      if (saved) {
        await expect(row.locator("input")).not.toBeChecked();
        await expect(row.locator(".skill-use")).toBeDisabled();
      } else {
        await expect(row.locator("input")).toBeChecked();
        await expect(row.locator(".skill-use")).toBeEnabled();
      }
      await expect(page.locator("#skillSummary")).toHaveText(
        `${saved ? 0 : 1} ready · 1 discovered`,
      );
    } finally {
      await stopOrbitWebUi();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

test("keeps Skill settings locked across a delayed save and busy transition", async ({
  page,
}) => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-skill-lock-"));
  const config = structuredClone(DEFAULT_CONFIG);
  config.skills.directories = [".agents/skills"];
  config.skills.disabled = ["not-installed"];
  for (const name of ["first", "second"]) {
    const dir = join(cwd, ".agents", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: Review code\n---\nReview the code.`,
    );
  }
  let releaseSave = () => {};
  const pending = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let requests = 0;
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config,
      port: 0,
      open: false,
      updateSettings: async (patch) => {
        requests += 1;
        if (requests === 1) await pending;
        if (patch.skillsDisabled) config.skills.disabled = patch.skillsDisabled;
        return { ok: true };
      },
    });
    await page.goto(handle.url);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
    await page.keyboard.press("Control+,");
    const first = page.locator(".skill-row").filter({ hasText: "$first" });
    const second = page.locator(".skill-row").filter({ hasText: "$second" });
    await first.locator("label.switch").click();
    await expect.poll(() => requests).toBe(1);
    for (const selector of [
      "#skillsEnabled",
      "#skillsMaxActive",
      "#refreshSkills",
    ])
      await expect(page.locator(selector)).toBeDisabled();
    await expect(second.locator("input")).toBeDisabled();
    eventBus.emitEvent("ui_turn_started", {
      turnId: "skill-settings-cycle",
      source: "terminal",
      prompt: "busy cycle",
    });
    await expect(page.getByTestId("orbit-app")).toHaveClass(/is-busy/);
    eventBus.emitEvent("ui_turn_completed", {
      turnId: "skill-settings-cycle",
      source: "terminal",
      status: "completed",
    });
    await expect(page.getByTestId("orbit-app")).not.toHaveClass(/is-busy/);
    await expect(second.locator("input")).toBeDisabled();
    releaseSave();
    await expect(second.locator("input")).toBeEnabled();
    await second.locator("label.switch").click();
    await expect
      .poll(() => config.skills.disabled)
      .toEqual(["not-installed", "first", "second"]);
    await expect(first.locator("input")).not.toBeChecked();
    await expect(second.locator("input")).not.toBeChecked();
    await expect(page.locator("#refreshSkills")).toBeEnabled();
  } finally {
    releaseSave();
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("locks capability submission and distinguishes creation from catalog refresh failure", async ({
  page,
}) => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-webui-submit-"));
  let releaseRequest = () => {};
  const pending = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let requests = 0;
  let refreshFails = false;
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
    });
    await page.goto(handle.url);
    await expect(page.locator("#connectionState")).toHaveClass(/is-connected/);
    await page.keyboard.press("Control+,");
    await page.locator("#addCapabilityButton").click();
    await page.locator("#capabilityName").fill("review-");
    await page.locator("#capabilityDescription").fill("Review code");
    await page.locator("#capabilityInstructions").fill("Review the changes.");
    await page.locator("#createCapabilityButton").click();
    await expect(page.locator("#capabilityName")).toBeFocused();
    await expect(page.locator("#capabilityFormError")).toContainText(
      "starts and ends",
    );
    await page.locator("#capabilityName").fill("review");
    await page.route("**/api/skills", async (route) => {
      if (refreshFails)
        await route.fulfill({
          status: 503,
          json: { message: "Catalog unavailable" },
        });
      else await route.continue();
    });
    await page.route("**/api/capability", async (route) => {
      requests += 1;
      await pending;
      refreshFails = true;
      await route.continue();
    });
    await page.locator("#createCapabilityButton").click();
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator("#capabilityCreator")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    for (const selector of [
      "#capabilityInstructions",
      "#capabilityName",
      "#cancelCapabilityButton",
      "#addCapabilityButton",
    ])
      await expect(page.locator(selector)).toBeDisabled();
    await page
      .locator("#capabilityCreator")
      .evaluate((form: HTMLFormElement) => form.requestSubmit());
    eventBus.emitEvent("ui_turn_started", {
      turnId: "capability-pending-cycle",
      source: "terminal",
      prompt: "busy cycle",
    });
    await expect(page.getByTestId("orbit-app")).toHaveClass(/is-busy/);
    eventBus.emitEvent("ui_turn_completed", {
      turnId: "capability-pending-cycle",
      source: "terminal",
      status: "completed",
    });
    await expect(page.getByTestId("orbit-app")).not.toHaveClass(/is-busy/);
    await expect(page.locator("#createCapabilityButton")).toBeDisabled();
    releaseRequest();
    await expect(page.locator("#capabilityCreator")).toBeHidden();
    await expect(page.locator(".toast.is-success")).toContainText(
      "Capability added",
    );
    await expect(page.locator(".toast.is-warning")).toContainText(
      "catalog could not refresh",
    );
    await expect(page.locator("#addCapabilityButton")).toBeFocused();
    await expect(page.locator("#capabilityFormError")).toBeHidden();
    expect(requests).toBe(1);
    expect(
      readFileSync(join(cwd, ".orbit", "skills", "review", "SKILL.md"), "utf8"),
    ).toContain("Review the changes.");
  } finally {
    releaseRequest();
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});
