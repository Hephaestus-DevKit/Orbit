import {
  promises as fs,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeNewScaffoldFile } from "./ScaffoldFileWriter.js";

describe("writeNewScaffoldFile", () => {
  let cwd: string;
  let path: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-scaffold-writer-"));
    path = join(cwd, "scaffold.md");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("preserves existing content", async () => {
    writeFileSync(path, "user-owned");
    await expect(writeNewScaffoldFile(path, "generated")).rejects.toMatchObject(
      { code: "EEXIST" },
    );
    expect(readFileSync(path, "utf8")).toBe("user-owned");
  });

  it("publishes complete UTF-8 content to a new file", async () => {
    await writeNewScaffoldFile(path, "# 工作流\n\nReview the change.\n");
    expect(readFileSync(path, "utf8")).toBe("# 工作流\n\nReview the change.\n");
  });

  it("does not delete a concurrent replacement when its own write fails", async () => {
    const originalOpen = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const file = await originalOpen(...args);
      vi.spyOn(file, "writeFile").mockImplementationOnce(async () => {
        await fs.rename(path, join(cwd, "abandoned.md"));
        writeFileSync(path, "replacement");
        throw new Error("Write interrupted");
      });
      return file;
    });
    await expect(writeNewScaffoldFile(path, "generated")).rejects.toThrow(
      "Write interrupted",
    );
    expect(readFileSync(path, "utf8")).toBe("replacement");
  });

  it("reports cleanup failure instead of silently claiming a retry is safe", async () => {
    const originalOpen = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const file = await originalOpen(...args);
      vi.spyOn(file, "writeFile").mockRejectedValueOnce(
        new Error("Write interrupted"),
      );
      return file;
    });
    vi.spyOn(fs, "unlink").mockRejectedValueOnce(new Error("Cleanup denied"));
    await expect(writeNewScaffoldFile(path, "generated")).rejects.toMatchObject(
      {
        message: `Scaffold creation failed; could not clean up incomplete file: ${path}`,
        errors: [
          expect.objectContaining({ message: "Write interrupted" }),
          expect.objectContaining({ message: "Cleanup denied" }),
        ],
      },
    );
  });
});
