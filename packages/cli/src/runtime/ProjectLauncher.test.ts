import { EventEmitter } from "events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, parse } from "path";
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

    const launchPromise = launchOrbitProject(
      { action: "create", path: project },
      {
        entryPoint: "C:/orbit/index.js",
        executable: "node",
        launch: launch as never,
      },
    );
    child.emit("message", {
      type: PROJECT_WEB_UI_READY_MESSAGE,
      url: "http://127.0.0.1:6123/#token=abcdefghijklmnopqrstuvwxyz123456",
    });
    const launchedProject = await launchPromise;
    const canonicalProject = realpathSync.native(project);

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
  });

  it("rejects missing existing projects and relative paths", async () => {
    await expect(
      launchOrbitProject({ action: "open", path: "relative/project" }),
    ).rejects.toMatchObject({
      name: "ProjectLaunchError",
      code: "absolute_path_required",
    });

    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    await expect(
      launchOrbitProject({ action: "open", path: join(root, "missing") }),
    ).rejects.toThrow("does not exist");
  });

  it("opens an existing directory when create is used to add a project", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    const existing = join(root, "existing");
    mkdirSync(existing);
    const sentinel = join(existing, "keep.txt");
    writeFileSync(sentinel, "preserved");
    const child = Object.assign(new EventEmitter(), {
      connected: true,
      disconnect: vi.fn(),
      kill: vi.fn(),
      unref: vi.fn(),
    });
    const launch = vi.fn(() => child);

    const launchPromise = launchOrbitProject(
      { action: "create", path: existing },
      {
        entryPoint: "C:/orbit/index.js",
        executable: "node",
        launch: launch as never,
      },
    );
    child.emit("message", {
      type: PROJECT_WEB_UI_READY_MESSAGE,
      url: "http://127.0.0.1:6123/#token=abcdefghijklmnopqrstuvwxyz123456",
    });

    await expect(launchPromise).resolves.toEqual({
      path: realpathSync.native(existing),
      url: "http://127.0.0.1:6123/#token=abcdefghijklmnopqrstuvwxyz123456",
    });
    expect(readFileSync(sentinel, "utf8")).toBe("preserved");
  });

  it("requires a real parent when creating a new project directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    const missingParentProject = join(root, "missing-parent", "project");
    await expect(
      launchOrbitProject({ action: "create", path: missingParentProject }),
    ).rejects.toThrow("parent folder does not exist");
    expect(() => realpathSync(join(root, "missing-parent"))).toThrow();
  });

  it("rejects files and filesystem roots as project folders", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    const file = join(root, "not-a-directory.txt");
    writeFileSync(file, "not a project");

    await expect(
      launchOrbitProject({ action: "open", path: file }),
    ).rejects.toThrow("must point to a directory");
    await expect(
      launchOrbitProject({ action: "create", path: file }),
    ).rejects.toThrow("must point to a directory");
    await expect(
      launchOrbitProject({ action: "open", path: parse(root).root }),
    ).rejects.toThrow("filesystem root");
  });

  it("rejects malformed child handoff URLs", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    const project = join(root, "existing");
    mkdirSync(project);
    const child = Object.assign(new EventEmitter(), {
      connected: true,
      disconnect: vi.fn(),
      kill: vi.fn(),
      unref: vi.fn(),
    });
    const launchPromise = launchOrbitProject(
      { action: "open", path: project },
      {
        entryPoint: "C:/orbit/index.js",
        launch: vi.fn(() => child) as never,
      },
    );

    child.emit("message", {
      type: PROJECT_WEB_UI_READY_MESSAGE,
      url: "http://127.0.0.1:6123/redirect?next=evil#token=abcdefghijklmnopqrstuvwxyz123456",
    });
    child.emit("error", new Error("startup failed"));

    await expect(launchPromise).rejects.toMatchObject({
      code: "launch_failed",
      message: expect.stringContaining("startup failed"),
    });
  });

  it("classifies early exits and terminates a stalled startup", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    const project = join(root, "existing");
    mkdirSync(project);
    const makeChild = () =>
      Object.assign(new EventEmitter(), {
        connected: true,
        disconnect: vi.fn(),
        kill: vi.fn(),
        unref: vi.fn(),
      });

    const exitingChild = makeChild();
    const exiting = launchOrbitProject(
      { action: "open", path: project },
      {
        entryPoint: "C:/orbit/index.js",
        launch: vi.fn(() => exitingChild) as never,
      },
    );
    const exitingExpectation = expect(exiting).rejects.toMatchObject({
      code: "startup_failed",
    });
    exitingChild.emit("exit", 2);
    await exitingExpectation;

    vi.useFakeTimers();
    try {
      const stalledChild = makeChild();
      const stalled = launchOrbitProject(
        { action: "open", path: project },
        {
          entryPoint: "C:/orbit/index.js",
          startupTimeoutMs: 1_000,
          launch: vi.fn(() => stalledChild) as never,
        },
      );
      const stalledExpectation = expect(stalled).rejects.toMatchObject({
        code: "startup_timeout",
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await stalledExpectation;
      expect(stalledChild.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies synchronous process launch failures without exposing internals", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-project-"));
    temporaryPaths.push(root);
    const project = join(root, "existing");
    mkdirSync(project);

    await expect(
      launchOrbitProject(
        { action: "open", path: project },
        {
          entryPoint: "C:/orbit/index.js",
          launch: vi.fn(() => {
            throw new Error("private process detail");
          }) as never,
        },
      ),
    ).rejects.toMatchObject({
      name: "ProjectLaunchError",
      code: "launch_failed",
      message: "Orbit project could not be started.",
    });
  });
});
