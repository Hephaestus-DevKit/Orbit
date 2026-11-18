import { mockModule,  describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";

const execMock = vi.fn(
    (
      _command: string,
      _options: object,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      callback(null, "");
      return {};
    },
  );

await mockModule(import.meta.resolve("child_process"), async (importOriginal) => ({
  ...(await importOriginal<typeof import("child_process")>()),
  exec: execMock,
}));

const { FullscreenTui } = await import("./FullscreenTui.js");



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
