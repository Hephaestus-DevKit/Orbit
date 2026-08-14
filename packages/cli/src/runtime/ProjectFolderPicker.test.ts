import { describe, expect, it, vi } from "vitest";
import { selectOrbitProjectFolder } from "./ProjectFolderPicker.js";

describe("selectOrbitProjectFolder", () => {
  it("uses the native Windows folder dialog and returns its path", async () => {
    const run = vi.fn(async () => ({
      stdout: "C:\\work\\orbit-project\r\n",
    }));

    await expect(
      selectOrbitProjectFolder({ platform: "win32", run }),
    ).resolves.toBe("C:\\work\\orbit-project");
    expect(run).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-STA", "-Command"]),
    );
    const invocation = run.mock.calls[0];
    expect(invocation).toBeDefined();
    const command = invocation?.[1].at(-1);
    expect(command).toContain("SetProcessDpiAwarenessContext");
    expect(command).toContain("GetForegroundWindow");
    expect(command).toContain("FileOpenOptions.PickFolders");
    expect(command).toContain("dialog.Show(owner)");
    expect(command).not.toContain("FolderBrowserDialog");
  });

  it("treats a cancelled Windows picker as an empty selection", async () => {
    const run = vi.fn(async () => ({ stdout: "" }));

    await expect(
      selectOrbitProjectFolder({ platform: "win32", run }),
    ).resolves.toBeNull();
  });

  it("treats a cancelled Linux picker as a non-error", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("cancelled"), { code: 1 });
    });

    await expect(
      selectOrbitProjectFolder({ platform: "linux", run }),
    ).resolves.toBeNull();
  });

  it("reports a real picker failure even when the process exits with code one", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("display unavailable"), {
        code: 1,
        stderr: "Unable to initialize GTK",
      });
    });

    await expect(
      selectOrbitProjectFolder({ platform: "linux", run }),
    ).rejects.toThrow("folder picker is unavailable");
  });

  it("uses the native macOS folder picker without shell interpolation", async () => {
    const run = vi.fn(async () => ({
      stdout: "/Users/orbit/Modeling Project/\n",
    }));

    await expect(
      selectOrbitProjectFolder({ platform: "darwin", run }),
    ).resolves.toBe("/Users/orbit/Modeling Project/");
    expect(run).toHaveBeenCalledWith("osascript", [
      "-e",
      expect.stringContaining("choose folder"),
    ]);
  });

  it("provides a manual-path fallback message when no picker exists", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    await expect(
      selectOrbitProjectFolder({ platform: "linux", run }),
    ).rejects.toThrow("enter the path manually");
  });
});
