import { EventEmitter } from "events";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  launchOrbitProject,
  PROJECT_WEB_UI_READY_MESSAGE,
} from "./ProjectLauncher.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("launchOrbitProject", () => {
  it("creates a folder and returns an isolated WebUI handoff URL", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    const project = join(root, "new-project");
    const child = Object.assign(new EventEmitter(), {
      connected: true,
      disconnect: vi.fn(),
      kill: vi.fn(),
      unref: vi.fn(),
    });
    const launch = vi.fn(() => child);
    const registry = { register: vi.fn() };

    const launchPromise = launchOrbitProject(
      { action: "create", path: project },
      {
        entryPoint: "C:/orbit/index.js",
        executable: "node",
        launch: launch as never,
        registry,
      },
    );
    child.emit("message", {
      type: PROJECT_WEB_UI_READY_MESSAGE,
      url: "http://127.0.0.1:6123/#token=abcdefghijklmnopqrstuvwxyz123456",
    });
    const launchedProject = await launchPromise;
    const canonicalProject = realpathSync(project);

    expect(launchedProject).toEqual({
      path: canonicalProject,
      url: "http://127.0.0.1:6123/#token=abcdefghijklmnopqrstuvwxyz123456",
    });
    expect(launch).toHaveBeenCalledWith(
      "node",
      ["C:/orbit/index.js", "webui", "--cwd", canonicalProject],
      expect.objectContaining({
        cwd: canonicalProject,
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      }),
    );
    expect(child.disconnect).toHaveBeenCalledOnce();
    expect(child.unref).toHaveBeenCalledOnce();
    expect(registry.register).toHaveBeenCalledWith(canonicalProject);
  });

  it("rejects missing existing projects and relative paths", async () => {
    await expect(
      launchOrbitProject({ action: "open", path: "relative/project" }),
    ).rejects.toThrow("absolute");

    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    await expect(
      launchOrbitProject({ action: "open", path: join(root, "missing") }),
    ).rejects.toThrow("does not exist");
  });
});
