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
import { writeLocalRuntimeState } from "../runtime/LocalRuntimeState.js";
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
    purgeUserCredentials: vi.fn(),
    clearBrowserStorage: vi.fn(async () => {}),
    home,
    interactive: true,
    language: "zh" as const,
    write,
    manager: { prepareUninstall: () => ({ directory: "/test/npm", remove }) },
  };
  return { home, registry, store, homeStore, project, remove, write, deps };
}

describe("global uninstall", () => {
  it("purges personal and archived project data, reports disconnected folders, and retains source", async () => {
    const { deps, write, remove, home, project, registry } = setup();
    const missing = join(home, "offline");
    mkdirSync(missing);
    registry.register(missing);
    rmSync(missing, { recursive: true });
    const damaged = join(project, ".orbit", "sessions", "sess_damaged");
    mkdirSync(damaged);
    writeFileSync(join(damaged, "session.json"), "corrupt");
    writeFileSync(join(home, ".orbit", "input_history.json"), "private");
    writeFileSync(join(project, "orbit.config.yaml"), "{}");
    writeLocalRuntimeState(project, { webUiPort: 16540, webUiPorts: [16540, 16541] });
    const confirm = vi.fn(async () => true);
    await runUninstall({}, { ...deps, confirm });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.flat().join("\n")).toContain("目录不可访问");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(deps.purgeUserCredentials).toHaveBeenCalledTimes(1);
    if (process.platform === "darwin")
      expect(deps.clearBrowserStorage).toHaveBeenCalledWith([16540, 16541]);
    expect(existsSync(join(home, ".orbit"))).toBe(false);
    expect(existsSync(join(project, ".orbit"))).toBe(false);
    expect(readFileSync(join(project, "source.ts"), "utf8")).toBe("keep");
    expect(readFileSync(join(project, "orbit.config.yaml"), "utf8")).toBe("{}");
  });

  it("offers complete cleanup with zero registered projects, including a key with no files", async () => {
    const { home, deps } = setup();
    rmSync(join(home, ".orbit"), { recursive: true });
    const confirm = vi.fn(async () => true);
    await runUninstall({}, { ...deps, confirm });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(deps.purgeUserCredentials).toHaveBeenCalledTimes(1);
    expect(existsSync(join(home, ".orbit"))).toBe(false);
  });

  it("removes verified chats in custom shared folders and unlinks internal links without touching their targets", async () => {
    const { home, project, deps } = setup();
    writeFileSync(
      join(home, ".orbit", "config.yaml"),
      "session:\n  store: jsonl\n  path: custom-chats\n",
    );
    const store = new SessionStore(project, "custom-chats");
    const chat = store.createSession("test", "model");
    writeFileSync(join(project, "custom-chats", "notes.txt"), "keep");
    symlinkSync(
      join(project, "custom-chats"),
      join(project, ".orbit", "export"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await runUninstall({}, { ...deps, confirm: async () => true });
    expect(existsSync(join(project, "custom-chats", chat.id))).toBe(false);
    expect(readFileSync(join(project, "custom-chats", "notes.txt"), "utf8")).toBe("keep");
  });

  it("detects registrations added during uninstall before clearing the registry", async () => {
    const { deps, store, registry, remove, home } = setup();
    const added = join(home, "new");
    mkdirSync(added);
    remove.mockImplementation(() => {
      registry.register(added);
    });
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "尚未全部清除",
    );
    expect(store.listSessions()).toHaveLength(1);
    expect(registry.list({ includeArchived: true })).toHaveLength(3);
    expect(deps.purgeUserCredentials).not.toHaveBeenCalled();
  });

  it("reports credential deletion failures and preserves the project inventory", async () => {
    const { deps, registry, home } = setup();
    deps.purgeUserCredentials.mockImplementation(() => {
      throw new Error("Keychain unavailable");
    });
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "Keychain unavailable",
    );
    expect(registry.list({ includeArchived: true })).toHaveLength(2);
    expect(existsSync(join(home, ".orbit", "secrets.json"))).toBe(true);
  });

  it("refuses an unknown project inventory if both registry snapshots are corrupt", async () => {
    const { deps, home, remove } = setup();
    for (const name of ["projects.json", "projects.json.bak"])
      writeFileSync(join(home, ".orbit", name), "{");
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "determine registered projects",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(deps.purgeUserCredentials).not.toHaveBeenCalled();
  });

  it("detects newly created chats without requiring old managed chats to be readable", async () => {
    const { deps, remove, store } = setup();
    remove.mockImplementation(() => {
      store.createSession("test", "new");
    });
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "Chats changed",
    );
    expect(store.listSessions()).toHaveLength(2);
    expect(deps.purgeUserCredentials).not.toHaveBeenCalled();
  });

  it("protects a registered project located under a cleanup target", async () => {
    const { deps, remove, registry, home } = setup();
    const nested = join(home, ".orbit", "repository");
    mkdirSync(nested);
    registry.register(nested);
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "Move the registered project",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(existsSync(nested)).toBe(true);
  });

  it("preserves a live daemon and its authentication data", async () => {
    const { deps, remove, project } = setup();
    const folder = join(project, ".orbit", "daemon");
    mkdirSync(folder);
    const tokenPath = join(folder, "token");
    writeFileSync(tokenPath, "fixture");
    writeFileSync(
      join(folder, "daemon.json"),
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        host: "127.0.0.1",
        port: 12345,
        protocol: "http",
        tokenPath,
        roots: [project],
      }),
    );
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "running Orbit daemon",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(existsSync(tokenPath)).toBe(true);
  });

  it("keeps worktree source and custom store targets reached through links", async () => {
    const { deps, remove, project, home } = setup();
    const tree = join(project, ".orbit", "worktrees", "pending");
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, ".git"), "gitdir: fixture");
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "Git worktree",
    );
    rmSync(tree, { recursive: true });
    symlinkSync(home, join(project, "linked"), process.platform === "win32" ? "junction" : "dir");
    writeFileSync(join(home, ".orbit", "config.yaml"), "session:\n  path: linked\n");
    await expect(runUninstall({}, { ...deps, confirm: async () => true })).rejects.toThrow(
      "boundary",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps all data if the user declines cleanup or uses --yes", async () => {
    const { deps, store, registry, remove } = setup();
    const replies = [false, true];
    const confirm = vi.fn(async () => replies.shift()!);
    await runUninstall({}, { ...deps, confirm });
    await runUninstall({ yes: true }, { ...deps, interactive: false, confirm });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(deps.purgeUserCredentials).not.toHaveBeenCalled();
    expect(deps.clearBrowserStorage).not.toHaveBeenCalled();
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
