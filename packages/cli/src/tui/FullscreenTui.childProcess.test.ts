import { describe, expect, it, vi } from "vitest";

const execMock = vi.hoisted(() =>
  vi.fn(
    (
      _command: string,
      _options: object,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      callback(null, "");
      return {};
    },
  ),
);

vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("child_process")>()),
  exec: execMock,
}));

import { FullscreenTui } from "./FullscreenTui.js";

describe("FullscreenTui child process visibility", () => {
  it("hides Git status processes during UI refreshes", async () => {
    const tui = new FullscreenTui("C:/repo", "model", "test-version");
    vi.spyOn(tui as unknown as { render(): void }, "render").mockImplementation(
      () => undefined,
    );

    await (
      tui as unknown as { refreshGitSummaryAsync(): Promise<void> }
    ).refreshGitSummaryAsync();

    expect(execMock).toHaveBeenCalledTimes(2);
    for (const call of execMock.mock.calls) {
      expect(call[1]).toMatchObject({
        cwd: "C:/repo",
        windowsHide: true,
      });
    }
  });
});
