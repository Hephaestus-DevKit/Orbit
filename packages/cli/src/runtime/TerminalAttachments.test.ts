import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTerminalImage } from "./TerminalAttachments.js";

describe("TerminalAttachments", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  it("loads bounded, signature-checked workspace images", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-terminal-image-"));
    roots.push(cwd);
    writeFileSync(
      join(cwd, "截图.png"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
    );
    expect(loadTerminalImage("截图.png", { cwd })).toMatchObject({
      type: "image",
      mediaType: "image/png",
      name: "截图.png",
    });
  });

  it("rejects spoofed, unsupported, and outside-workspace images", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-terminal-image-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "fake.png"), "not-png");
    writeFileSync(join(cwd, "fake.txt"), "not-image");
    expect(() => loadTerminalImage("fake.png", { cwd })).toThrow(
      "bytes do not match",
    );
    expect(() => loadTerminalImage("fake.txt", { cwd })).toThrow("support PNG");
    expect(() => loadTerminalImage("../outside.png", { cwd })).toThrow(
      "outside workspace",
    );
  });
});
