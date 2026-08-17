import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Prompt,
  resolvePlainMultiSelection,
  resolvePlainSelection,
} from "./Prompt.js";

describe("Prompt.askSelectWithDelete", () => {
  afterEach(() => {
    Prompt.setTuiInstance(null);
    Prompt.setAccessibilityMode("standard");
  });

  it("forwards delete-capable select prompts to the active TUI", async () => {
    const showPrompt = vi
      .fn()
      .mockResolvedValue({ action: "delete", value: "session-1" });

    Prompt.setTuiInstance({
      isActive: true,
      showPrompt,
    });

    await expect(
      Prompt.askSelectWithDelete("Choose a session", [
        { value: "session-1", label: "Session 1" },
      ]),
    ).resolves.toEqual({ action: "delete", value: "session-1" });

    expect(showPrompt).toHaveBeenCalledWith({
      type: "select",
      message: "Choose a session",
      options: [{ value: "session-1", label: "Session 1" }],
      deletable: true,
      initialSelectedValue: undefined,
      suppressCloseRenderOnDelete: undefined,
    });
  });

  it("forwards initial selection and delete render options", async () => {
    const showPrompt = vi
      .fn()
      .mockResolvedValue({ action: "delete", value: "session-2" });

    Prompt.setTuiInstance({
      isActive: true,
      showPrompt,
    });

    await Prompt.askSelectWithDelete(
      "Choose a session",
      [
        { value: "session-1", label: "Session 1" },
        { value: "session-2", label: "Session 2" },
      ],
      {
        initialSelectedValue: "session-2",
        suppressCloseRenderOnDelete: true,
      },
    );

    expect(showPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelectedValue: "session-2",
        suppressCloseRenderOnDelete: true,
      }),
    );
  });

  it("normalizes TUI string and null responses", async () => {
    const showPrompt = vi
      .fn()
      .mockResolvedValueOnce("session-2")
      .mockResolvedValueOnce(null);

    Prompt.setTuiInstance({
      isActive: true,
      showPrompt,
    });

    await expect(
      Prompt.askSelectWithDelete("Choose a session", [
        { value: "session-2", label: "Session 2" },
      ]),
    ).resolves.toEqual({ action: "select", value: "session-2" });

    await expect(
      Prompt.askSelectWithDelete("Choose a session", [
        { value: "session-2", label: "Session 2" },
      ]),
    ).resolves.toEqual({ action: "cancel" });
  });

  it("rejects malformed active TUI response types", async () => {
    const showPrompt = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce("yes")
      .mockResolvedValueOnce(["not", "text"])
      .mockResolvedValueOnce(["valid", 42]);

    Prompt.setTuiInstance({
      isActive: true,
      showPrompt,
    });

    await expect(Prompt.askPassword("Password")).resolves.toBeNull();
    await expect(Prompt.askApproval("Approve")).resolves.toBe(false);
    await expect(Prompt.askText("Text")).resolves.toBeNull();
    await expect(
      Prompt.askMultiSelect("Choose", [{ value: "valid", label: "Valid" }]),
    ).resolves.toBeNull();
  });
});

describe("screen-reader prompt parsing", () => {
  const options = [
    { value: "flash", label: "DeepSeek Flash" },
    { value: "pro", label: "DeepSeek Pro" },
  ];

  it("accepts bounded numeric and exact-value selections", () => {
    expect(resolvePlainSelection("1", options)).toBe("flash");
    expect(resolvePlainSelection("pro", options)).toBe("pro");
    expect(resolvePlainSelection("3", options)).toBeNull();
    expect(resolvePlainSelection("unknown", options)).toBeNull();
  });

  it("deduplicates valid multi-selections and rejects mixed invalid input", () => {
    expect(resolvePlainMultiSelection("1, pro, 1", options)).toEqual([
      "flash",
      "pro",
    ]);
    expect(resolvePlainMultiSelection("", options)).toEqual([]);
    expect(resolvePlainMultiSelection("1, missing", options)).toBeNull();
  });

  it("reads an interactive password without echoing secret bytes", async () => {
    const isTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    const rawModeDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "setRawMode",
    );
    const output: string[] = [];
    try {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(process.stdin, "setRawMode", {
        configurable: true,
        value: vi.fn(() => process.stdin),
      });
      vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
      vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });
      Prompt.setAccessibilityMode("screen-reader");

      const password = Prompt.askPassword("Password");
      process.stdin.emit("data", Buffer.from("s3cret\r"));

      await expect(password).resolves.toBe("s3cret");
      expect(output.join("")).toContain("Password: ");
      expect(output.join("")).not.toContain("s3cret");
    } finally {
      Prompt.setAccessibilityMode("standard");
      vi.restoreAllMocks();
      if (isTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", isTtyDescriptor);
      }
      if (rawModeDescriptor) {
        Object.defineProperty(process.stdin, "setRawMode", rawModeDescriptor);
      } else {
        delete (process.stdin as NodeJS.ReadStream & { setRawMode?: unknown })
          .setRawMode;
      }
    }
  });
});
