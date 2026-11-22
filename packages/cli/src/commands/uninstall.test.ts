import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectRegistry, SessionStore } from "@orbit-build/session";
import {
  afterEach,
  describe,
  expect,
  it,
  mockTools as vi,
} from "../../../../scripts/testing/support.mjs";
import { readLocalRuntimeState, writeLocalRuntimeState } from "../runtime/LocalRuntimeState.js";
import { runUninstall } from "./uninstall.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "orbit-uninstall-"));
  roots.push(root);
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home);
  mkdirSync(project);
  const registry = new ProjectRegistry(join(home, ".orbit"));
  registry.register(home);
  registry.archive(registry.register(project).id);
  const store = new SessionStore(project);
  const chat = store.createSession("test", "model");
  const homeStore = new SessionStore(home);
  homeStore.createSession("test", "model");
  writeLocalRuntimeState(project, { lastSessionId: chat.id, language: "zh" });
  writeFileSync(join(project, "source.ts"), "keep");
  writeFileSync(join(home, ".orbit", "secrets.json"), "{}");
  const remove = vi.fn();
  const write = vi.fn();
  const deps = {
    home,
    interactive: true,
    language: "zh" as const,
    write,
    manager: { prepareUninstall: () => ({ directory: "/test/npm", remove }) },
  };
  return { home, registry, store, homeStore, project, remove, write, deps };
}

describe("global uninstall", () => {
  it("asks once for all registered projects and preserves source and user settings when deleting chats", async () => {
    const { deps, write, remove, home, project, store, homeStore, registry } = setup();
    const missing = join(home, "offline");
    mkdirSync(missing);
    registry.register(missing);
    rmSync(missing, { recursive: true });
    const confirm = vi.fn(async () => true);
    await runUninstall({}, { ...deps, confirm });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.flat().join("\n")).toContain("目录不可访问");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(registry.list({ includeArchived: true })).toEqual([]);
    expect(JSON.parse(readFileSync(join(home, ".orbit", "projects.json.bak"), "utf8")).projects)
      .toEqual([]);
    expect(store.listSessions()).toEqual([]);
    expect(homeStore.listSessions()).toEqual([]);
    expect(readLocalRuntimeState(project)).toEqual({ language: "zh" });
    expect(existsSync(join(home, ".orbit", "secrets.json"))).toBe(true);
    expect(readFileSync(join(project, "source.ts"), "utf8")).toBe("keep");
  });

  it("clears saved chats from both configured storage and delegated runs", async () => {
    const { home, project, deps } = setup();
    writeFileSync(
      join(home, ".orbit", "config.yaml"),
      "session:\n  store: jsonl\n  path: .orbit/custom-chats\n",
    );
    const stores = [".orbit/custom-chats", ".orbit/agent-sessions"].map(root =>
      new SessionStore(project, root)
    );
    for (const store of stores) store.createSession("test", "model");
    await runUninstall({}, { ...deps, confirm: async () => true });
    for (const store of stores) expect(store.listSessions()).toEqual([]);
  });

  it("retains the registry if a new chat appears after preview", async () => {
    const { deps, store, registry, remove } = setup();
    remove.mockImplementation(() => {
      store.createSession("test", "new");
    });
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "尚未全部清除",
    );
    expect(store.listSessions()).toHaveLength(1);
    expect(registry.list({ includeArchived: true })).toHaveLength(2);
  });

  it("keeps all data if the user declines cleanup or uses --yes", async () => {
    const { deps, store, registry, remove } = setup();
    const replies = [false, true];
    const confirm = vi.fn(async () => replies.shift()!);
    await runUninstall({}, { ...deps, confirm });
    await runUninstall({ yes: true }, { ...deps, interactive: false, confirm });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(registry.list({ includeArchived: true })).toHaveLength(2);
    expect(store.listSessions()).toHaveLength(1);
  });

  it("leaves everything in place on cancellation or a failed npm uninstall", async () => {
    const { deps, store, registry, remove } = setup();
    const replies = [true, false];
    await runUninstall({}, { ...deps, confirm: async () => replies.shift()! });
    expect(remove).not.toHaveBeenCalled();
    await expect(runUninstall({}, { ...deps, interactive: false })).rejects.toThrow("--yes");
    remove.mockImplementation(() => {
      throw new Error("npm failed");
    });
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "npm failed",
    );
    expect(store.listSessions()).toHaveLength(1);
    expect(registry.list({ includeArchived: true })).toHaveLength(2);
  });

  it("refuses to follow a registered folder that was replaced by a link", async () => {
    const { deps, project, home, remove, homeStore } = setup();
    rmSync(project, { recursive: true });
    symlinkSync(home, project, process.platform === "win32" ? "junction" : "dir");
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "registered path",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(homeStore.listSessions()).toHaveLength(1);
  });
});
