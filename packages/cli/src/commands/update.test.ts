import { describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";
import { runUpdate } from "./update.js";

describe("runUpdate", () => {
  it("reports an available update without mutating in check mode", async () => {
    const manager = createManager(true);
    const output: string[] = [];

    const result = await runUpdate(
      "0.1.6",
      { check: true },
      { manager, write: (text) => output.push(text) },
    );

    expect(result.installed).toBe(false);
    expect(result.restartRequired).toBe(false);
    expect(manager.install).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("0.1.6");
    expect(output.join("\n")).toContain("0.2.0");
  });

  it("uses JSON as a non-destructive check unless --yes is explicit", async () => {
    const manager = createManager(true);
    const output: string[] = [];

    await runUpdate(
      "0.1.6",
      { json: true },
      { manager, interactive: false, write: (text) => output.push(text) },
    );

    expect(manager.install).not.toHaveBeenCalled();
    expect(JSON.parse(output[0])).toMatchObject({
      schemaVersion: 1,
      installed: false,
    });
  });

  it("installs the exact checked version after confirmation", async () => {
    const manager = createManager(true);
    const beforeInstall = vi.fn();
    const afterInstall = vi.fn();

    const result = await runUpdate(
      "0.1.6",
      {},
      {
        manager,
        interactive: true,
        confirm: async () => true,
        write: vi.fn(),
        beforeInstall,
        afterInstall,
      },
    );

    expect(result.installed).toBe(true);
    expect(result.restartRequired).toBe(true);
    expect(manager.install).toHaveBeenCalledWith("0.2.0", true);
    expect(manager.readInstalledVersion).toHaveBeenCalledTimes(2);
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(afterInstall).toHaveBeenCalledOnce();
  });

  it("does not reinstall a package that only needs the old process restarted", async () => {
    const manager = createManager(true);
    manager.readInstalledVersion.mockReturnValue("0.2.0");
    const output: string[] = [];

    const result = await runUpdate(
      "0.1.6",
      { yes: true },
      { manager, write: (text) => output.push(text) },
    );

    expect(result).toMatchObject({
      installed: false,
      restartRequired: true,
    });
    expect(manager.install).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("this process is still 0.1.6");
  });

  it("states that the verified package needs a process and Web UI restart", async () => {
    const manager = createManager(true);
    const output: string[] = [];

    await runUpdate(
      "0.1.6",
      { yes: true },
      { manager, write: (text) => output.push(text) },
    );

    expect(output.join("\n")).toContain("installed and verified");
    expect(output.join("\n")).toContain("This process is still 0.1.6");
    expect(output.join("\n")).toContain("reopen /webui");
  });

  it("rolls back when the installed version cannot be verified", async () => {
    const manager = createManager(true);
    manager.readInstalledVersion
      .mockReset()
      .mockReturnValueOnce("0.1.9")
      .mockReturnValueOnce("0.1.9")
      .mockReturnValueOnce("0.1.6");

    await expect(
      runUpdate("0.1.6", { yes: true }, { manager, write: vi.fn() }),
    ).rejects.toThrow("Orbit 0.1.6 was restored");
    expect(manager.install).toHaveBeenNthCalledWith(1, "0.2.0", true);
    expect(manager.install).toHaveBeenNthCalledWith(2, "0.1.6", true);
  });

  it("redacts credentials from install failures", async () => {
    const manager = createManager(true);
    manager.install
      .mockImplementationOnce(() => {
        throw new Error("Authorization: Bearer private-npm-token");
      })
      .mockImplementationOnce(() => undefined);
    manager.readInstalledVersion.mockReset().mockReturnValue("0.1.6");

    const error = await runUpdate(
      "0.1.6",
      { yes: true },
      { manager, write: vi.fn() },
    ).catch((caught: unknown) => caught);

    expect(String(error)).not.toContain("private-npm-token");
    expect(String(error)).toContain("***REDACTED***");
  });

  it("does not install when already current", async () => {
    const manager = createManager(false);
    const result = await runUpdate(
      "0.1.6",
      { yes: true },
      { manager, write: vi.fn() },
    );

    expect(result.installed).toBe(false);
    expect(manager.install).not.toHaveBeenCalled();
  });
});

function createManager(updateAvailable: boolean) {
  let installedVersion = "0.1.6";
  return {
    check: vi.fn(() => ({
      currentVersion: "0.1.6",
      latestVersion: updateAvailable ? "0.2.0" : "0.1.6",
      updateAvailable,
    })),
    install: vi.fn((version: string) => {
      installedVersion = version;
    }),
    readInstalledVersion: vi.fn(() => installedVersion),
  };
}
