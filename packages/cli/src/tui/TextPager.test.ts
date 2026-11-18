import {
  afterEach,
  describe,
  expect,
  it,
  mockTools as vi,
} from "../../../../scripts/testing/support.mjs";
import { pageText } from "./TextPager.js";

describe("pageText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints short text without taking over stdin", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const resume = vi.spyOn(process.stdin, "resume");

    await expect(pageText("first\nsecond")).resolves.toBe("completed");

    expect(log).toHaveBeenCalledWith("first\nsecond");
    expect(resume).not.toHaveBeenCalled();
  });

  it("prints long text directly when stdin is not interactive", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    const text = Array.from(
      { length: 100 },
      (_, index) => `line ${index}`,
    ).join("\n");

    try {
      await expect(pageText(text)).resolves.toBe("completed");

      expect(log).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith(text);
    } finally {
      if (descriptor) Object.defineProperty(process.stdin, "isTTY", descriptor);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });
});
