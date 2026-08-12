import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findDocumentationFailures } from "./verify-documentation.mjs";

describe("documentation verification", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "orbit-docs-"));
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "guide.md"), "# Guide\n", "utf8");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts repository-local files, anchors, and remote links", () => {
    writeFileSync(
      join(root, "README.md"),
      [
        "[guide](docs/guide.md#start)",
        "[section](#section)",
        "[website](https://example.com)",
      ].join("\n"),
      "utf8",
    );

    expect(findDocumentationFailures(root, ["README.md"])).toEqual([]);
  });

  it("rejects missing, escaping, and malformed local links", () => {
    writeFileSync(
      join(root, "README.md"),
      [
        "[missing](docs/missing.md)",
        "[outside](../outside.md)",
        "[malformed](docs/%E0%A4%A.md)",
      ].join("\n"),
      "utf8",
    );

    expect(findDocumentationFailures(root, ["README.md"])).toEqual([
      "README.md: local link does not exist: docs/missing.md",
      "README.md: local link escapes the repository: ../outside.md",
      "README.md: link contains invalid URI encoding: docs/%E0%A4%A.md",
    ]);
  });

  it("reports a missing Markdown source without throwing", () => {
    expect(findDocumentationFailures(root, ["renamed-away.md"])).toEqual([
      "renamed-away.md: Markdown source does not exist",
    ]);
  });
});
