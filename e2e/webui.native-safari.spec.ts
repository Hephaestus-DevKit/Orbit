import { ProjectRegistry, SessionStore } from "../packages/session/src/index.js";
import { RunCoordinator } from "../packages/cli/src/runtime/RunCoordinator.js";
import { handleWebUiProjectAction } from "../packages/cli/src/runtime/ProjectLauncher.js";
import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../packages/config/src/defaults.js";
import { OrbitWebUiRuntime } from "../packages/cli/src/runtime/webui/WebUiRuntime.js";
import {
  startOrbitWebUi,
  stopOrbitWebUi,
  type WebUiHandle,
} from "../packages/cli/src/runtime/webui/WebUiServer.js";
import type { WebUiApprovalSnapshot } from "../packages/cli/src/runtime/webui/WebUiContracts.js";
import type {
  SafariFrame,
  SafariWebDriver,
} from "../packages/cli/src/runtime/browser/SafariWebDriver.js";
import { clickSafari, readSafari, typeSafari, withSafari } from "./native-safari-driver.js";

// During a macOS window transition SafariDriver can briefly return a Stage Manager thumbnail.
async function captureViewport(safari: SafariWebDriver): Promise<SafariFrame> {
  const [width, height] = await readSafari(safari, "return [innerWidth, innerHeight]") as number[];
  let frame: SafariFrame;
  await expect(async () => {
    frame = await safari.captureFrame();
    expect(frame.width).toBeGreaterThanOrEqual(width);
    expect(frame.height).toBeGreaterThanOrEqual(height);
    expect(Math.abs(frame.width / frame.height - width / height)).toBeLessThan(0.02);
  }).toPass({ timeout: 6000, intervals: [150, 300, 500] });
  return frame!;
}

test("system Safari captures the Web UI and handles real keyboard input", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-native-safari-"));
  try {
    const handle = await startOrbitWebUi({
      cwd,
      config: structuredClone(DEFAULT_CONFIG),
      port: 0,
      open: false,
      loop: { getSessionId: () => "native-safari-test" },
    });
    await withSafari(async (safari) => {
      await safari.command("POST", "/window/rect", { width: 1200, height: 800 });
      await safari.command("POST", "/url", { url: handle.url });
      await expect.poll(
        () =>
          readSafari(
            safari,
            'return document.querySelector("#connectionState")?.classList.contains("is-connected")',
          ),
        { timeout: 10_000 },
      ).toBe(true);
      const before = await captureViewport(safari);
      writeFileSync(
        test.info().outputPath("system-safari-workspace.png"),
        Buffer.from(before.image, "base64"),
      );

      await clickSafari(safari, "#workspaceLocation summary");
      expect(
        await readSafari(safari, 'return document.querySelector("#workspaceFolder").textContent'),
      ).toBe(cwd);
      await safari.command("POST", "/actions", {
        actions: [{
          type: "key",
          id: "keyboard",
          actions: [{ type: "keyDown", value: "\uE00C" }, { type: "keyUp", value: "\uE00C" }],
        }],
      });
      await expect.poll(() =>
        readSafari(
          safari,
          'return !document.querySelector("#workspaceLocation").open && document.activeElement.matches("#workspaceLocation summary")',
        )
      ).toBe(true);
      await clickSafari(safari, "#commandsButton");
      await expect.poll(() =>
        readSafari(safari, 'return document.querySelector("#commandPalette").hidden')
      ).toBe(false);
      await expect.poll(async () => (await safari.captureFrame()).image === before.image)
        .toBe(false);
      await safari.command("POST", "/actions", {
        actions: [{
          type: "key",
          id: "keyboard",
          actions: [{ type: "keyDown", value: "\uE00C" }, { type: "keyUp", value: "\uE00C" }],
        }],
      });
      await expect.poll(() =>
        readSafari(safari, 'return document.querySelector("#commandPalette").hidden')
      ).toBe(true);
      await expect.poll(() => readSafari(safari, "return document.activeElement.id")).toBe(
        "commandsButton",
      );
      // Simulate the two observable keydown shapes while choosing an IME candidate.
      // Physical key input is exercised immediately afterwards.
      expect(
        await readSafari(
          safari,
          `
        const prompt = document.querySelector("#prompt");
        prompt.value = "/mo"; prompt.dispatchEvent(new Event("input", { bubbles: true }));
        prompt.focus();
        return [ { isComposing: true }, { keyCode: 229 } ].every(init =>
          prompt.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", bubbles: true, cancelable: true, ...init
          })) && prompt.value === "/mo"
        );
      `,
        ),
      ).toBe(true);
      await readSafari(safari, 'document.querySelector("#prompt").value = "";');
      await typeSafari(safari, "#prompt", "System Safari input");
      await expect.poll(() => readSafari(safari, 'return document.querySelector("#prompt").value'))
        .toBe("System Safari input");
    });
  } finally {
    await stopOrbitWebUi();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test(
  "system Safari reviews the exact pending edit in a narrow conversation",
  async () => {
    const testInfo = test.info();
    const cwd = mkdtempSync(join(tmpdir(), "orbit-safari-review-"));
    const decisions: boolean[] = [];
    let pending: WebUiApprovalSnapshot | undefined = {
      id: "5eaec042-0584-4690-8205-aa739a5350df",
      kind: "change",
      title: "保留对 README.md 的改动？",
      reason: "文件已修改。",
      preview: "@@ -1 +1 @@\n-Node 22\n+Node 24",
      requestedAt: new Date().toISOString(),
    };
    try {
      const server = await startOrbitWebUi({
        cwd,
        config: { ...structuredClone(DEFAULT_CONFIG), language: "zh" },
        port: 0,
        open: false,
        loop: {
          getSessionId: () => "safari-review",
          getHistory: () => [{
            id: "doc-task",
            role: "user",
            content: [{ type: "text", text: "校对安装说明" }],
          }],
          getQueuedInputs: () => ["检查文档", "汇总结果"].map((text, i) => ({
            id: "queued-" + i,
            mode: "follow_up",
            source: "web",
            text,
            attachments: [],
            createdAt: new Date().toISOString(),
          })),
        },
        getPendingApproval: () => pending,
        respondToApproval: decision => {
          if (decision.id !== pending?.id) throw Error("Unexpected review request");
          decisions.push(decision.approved);
          pending = undefined;
          return { ok: true };
        },
      });
      await withSafari(async safari => {
        await safari.command("POST", "/window/rect", { width: 390, height: 844 });
        await safari.command("POST", "/url", { url: server.url });
        await expect.poll(() =>
          readSafari(
            safari,
            "return document.querySelector('#connectionState')?.classList.contains('is-connected')",
          )
        ).toBe(true);
        expect(
          await readSafari(
            safari,
            "return [innerWidth, document.documentElement.scrollWidth, document.querySelector('#promptQueue').open, document.querySelector('#queueCount').textContent]",
          ),
        ).toEqual([390, 390, false, "2"]);
        await typeSafari(safari, "#prompt", "保留此草稿");
        await expect.poll(() =>
          readSafari(
            safari,
            `
          const button = document.querySelector("#approveApprovalButton");
          const box = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        `,
          )
        ).toBe(true);
        writeFileSync(
          testInfo.outputPath("system-safari-review.png"),
          Buffer.from((await captureViewport(safari)).image, "base64"),
        );
        await clickSafari(safari, "#approvalDiffButton");
        await expect.poll(() => readSafari(safari, "return document.activeElement.id")).toBe(
          "approvalDiffTitle",
        );
        expect(
          await readSafari(safari, "return document.querySelector('#approvalPreview').textContent"),
        ).toContain("+Node 24");
        // Inspect and dismiss details using the keyboard, then revisit the same diff.
        await safari.command("POST", "/actions", {
          actions: [{
            type: "key",
            id: "keyboard",
            actions: [{ type: "keyDown", value: "\uE00C" }, { type: "keyUp", value: "\uE00C" }],
          }],
        });
        await expect.poll(() => readSafari(safari, "return document.activeElement.id")).toBe(
          "approvalDiffButton",
        );
        await clickSafari(safari, "#approvalDiffButton");
        await clickSafari(safari, "#returnToApproval");
        await expect.poll(() =>
          readSafari(
            safari,
            "return document.querySelector('#workbench').hidden && document.activeElement.id === 'approvalPanel' && document.querySelector('#messageScroll').clientHeight > 200 && document.querySelector('#approveApprovalButton').offsetTop === document.querySelector('#denyApprovalButton').offsetTop",
          )
        ).toBe(true);
        expect(await readSafari(safari, "return document.querySelector('#prompt').value")).toBe(
          "保留此草稿",
        );
        expect(
          await readSafari(
            safari,
            "return document.querySelector('#denyApprovalButton').textContent",
          ),
        ).toBe("回退本次改动");
        expect(decisions).toEqual([]);
        await clickSafari(safari, "#denyApprovalButton");
        await expect.poll(() => decisions).toEqual([false]);
        await expect.poll(() =>
          readSafari(safari, "return document.querySelector('#approvalPanel').hidden")
        ).toBe(true);
      });
    } finally {
      await stopOrbitWebUi();
      rmSync(cwd, { recursive: true, force: true });
    }
  },
);

test("system Safari switches projects and chats in one narrow tab", async () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-safari-navigation-"));
  const atlas = join(root, "Atlas"), harbor = join(root, "Harbor");
  let active = "first";
  let home: WebUiHandle;
  let away: WebUiHandle | undefined;
  const projects = [atlas, harbor].map((path, i) => ({
    path,
    name: i ? "Harbor" : "Atlas",
    id: String(i),
    available: true,
    lastOpenedAt: "2026-01-01T00:00:00Z",
  }));
  const shared = {
    config: { ...structuredClone(DEFAULT_CONFIG), language: "en" as const },
    port: 0,
    getProjects: () => projects,
  };
  try {
    mkdirSync(atlas);
    mkdirSync(harbor);
    home = await startOrbitWebUi({
      ...shared,
      cwd: atlas,
      loop: {
        getSessionId: () => active,
        getSessions: () =>
          ["first", "second"].map(id => ({ id, title: id, updatedAt: "2026-01-01T00:00:00Z" })),
      },
      openProject: async () => ({ ok: true, url: away?.url }),
      updateSession: async action => {
        if (action.action === "resume") active = action.sessionId;
        return { ok: true };
      },
    });
    away = await new OrbitWebUiRuntime({
      ...shared,
      cwd: harbor,
      loop: { getSessionId: () => "harbor-chat" },
      openProject: async () => ({ ok: true, url: home.url }),
    }).start();
    await withSafari(async safari => {
      const handles = () => safari.command("GET", "/window/handles");
      const original = await handles();
      const waitForProject = (name: string) =>
        expect.poll(() =>
          readSafari(
            safari,
            "return !document.querySelector('#newTaskButton')?.disabled && document.querySelector('#sidebarWorkspace')?.textContent",
          )
        ).toBe(name);
      await safari.command("POST", "/window/rect", { width: 390, height: 810 });
      await safari.command("POST", "/url", { url: home.url });
      await waitForProject("Atlas");
      await clickSafari(safari, "#menuButton");
      await clickSafari(safari, '.recent-session[data-session-id="second"]');
      await expect.poll(() =>
        readSafari(safari, "return document.querySelector('#workspaceName').textContent")
      ).toBe("second");
      await typeSafari(safari, "#prompt", "Atlas draft");
      await clickSafari(safari, "#menuButton");
      await clickSafari(safari, "#findConversation");
      await typeSafari(safari, "#commandSearch", "Harbor");
      await clickSafari(safari, "#commandResults button");
      await waitForProject("Harbor");
      expect(await readSafari(safari, "return document.querySelector('#prompt').value")).toBe("");
      await clickSafari(safari, "#menuButton");
      await clickSafari(safari, ".registered-project-open");
      await waitForProject("Atlas");
      expect(
        await readSafari(
          safari,
          "return [document.querySelector('#workspaceName').textContent, document.querySelector('#prompt').value, document.documentElement.scrollWidth <= innerWidth]",
        ),
      ).toEqual(["second", "Atlas draft", true]);
      expect(await handles()).toEqual(original);
    });
  } finally {
    await away?.close();
    await stopOrbitWebUi();
    rmSync(root, { recursive: true, force: true });
  }
});

test("system Safari confirms project archival and restores its chats after reload", async () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-safari-project-archive-"));
  const cwd = join(root, "Sample project");
  mkdirSync(cwd);
  const registry = new ProjectRegistry(join(root, "registry"));
  const record = registry.register(cwd);
  const store = new SessionStore(cwd);
  const chat = store.createSession("test", "test");
  const coordinator = new RunCoordinator();
  try {
    const handle = await startOrbitWebUi({
      cwd,
      port: 0,
      config: { ...DEFAULT_CONFIG, language: "zh" },
      loop: { getSessions: () => store.listSessions(), getSessionId: () => chat.id },
      getProjects: () => registry.list({ includeArchived: true }),
      openProject: action => handleWebUiProjectAction(action, coordinator, registry),
    });
    await withSafari(async safari => {
      await safari.command("POST", "/window/rect", { width: 390, height: 810 });
      await safari.command("POST", "/url", { url: handle.url });
      await expect.poll(() =>
        readSafari(
          safari,
          'return !!document.querySelector("#archiveCurrentProject:enabled:not([hidden])")',
        )
      ).toBe(true);
      await clickSafari(safari, "#menuButton");
      await clickSafari(safari, "#archiveCurrentProject");
      await expect.poll(() =>
        readSafari(safari, 'return document.querySelector("#projectArchiveDialog").open')
      ).toBe(true);
      await clickSafari(safari, '#projectArchiveDialog [value="cancel"]');
      await expect.poll(() =>
        readSafari(safari, 'return document.querySelector("#projectArchiveDialog").open')
      ).toBe(false);
      expect(registry.list().map(p => p.id)).toEqual([record.id]);
      await clickSafari(safari, "#archiveCurrentProject");
      await clickSafari(safari, '#projectArchiveDialog [value="archive"]');
      await expect.poll(() => registry.list().length).toBe(0);
      await safari.command("POST", "/refresh", {});
      await expect.poll(() =>
        readSafari(
          safari,
          'return !!document.querySelector("#archivedWorkspace:not([hidden]) #restoreCurrentProject:enabled")',
        )
      ).toBe(true);
      await clickSafari(safari, "#restoreCurrentProject");
      await expect.poll(() => registry.list().length).toBe(1);
      await expect.poll(() =>
        readSafari(
          safari,
          'return document.querySelectorAll("#recentSessions .session-row").length',
        )
      ).toBe(1);
    });
  } finally {
    await stopOrbitWebUi();
    rmSync(root, { recursive: true, force: true });
  }
});
