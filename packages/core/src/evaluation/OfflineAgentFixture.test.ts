import { describe, expect, it } from "vitest";
import { OfflineAgentFixtureSchema } from "./OfflineAgentFixture.js";

describe("OfflineAgentFixture", () => {
  it("accepts a bounded portable workspace and applies optional defaults", () => {
    const fixture = OfflineAgentFixtureSchema.parse(baseFixture());

    expect(fixture.workspace.files).toEqual([]);
    expect(fixture.expected.transcriptIncludes).toEqual([]);
  });

  it.each(["../outside.txt", "/absolute.txt", "C:/absolute.txt", "a//b.txt"])(
    "rejects unsafe or non-portable fixture path %s",
    (path) => {
      const fixture = baseFixture();
      fixture.workspace = { files: [{ path, content: "unsafe" }] };

      expect(() => OfflineAgentFixtureSchema.parse(fixture)).toThrow(
        "workspace-relative",
      );
    },
  );

  it.each([
    " NESTED/file.txt",
    "nested/file.txt ",
    "nested/trailing.",
    "nested/bad:name.txt",
    "nested/NUL.txt",
    "nested/COM1.log",
    "nested/LPT².txt",
    "nested/control\u0000.txt",
    `nested/${"文".repeat(86)}.txt`,
  ])("rejects platform-specific fixture path %s", (path) => {
    const fixture = baseFixture();
    fixture.workspace = { files: [{ path, content: "unsafe" }] };

    expect(() => OfflineAgentFixtureSchema.parse(fixture)).toThrow(
      "portable across Windows, macOS, and Linux",
    );
  });

  it("canonicalizes portable Windows separators for cross-platform replay", () => {
    const fixture = baseFixture();
    fixture.workspace = {
      files: [{ path: "nested\\input.txt", content: "portable" }],
    };

    const parsed = OfflineAgentFixtureSchema.parse(fixture);

    expect(parsed.workspace.files[0]?.path).toBe("nested/input.txt");
  });

  it("rejects paths that collide on a case-insensitive checkout", () => {
    const fixture = baseFixture();
    fixture.workspace = {
      files: [
        { path: "Data/input.txt", content: "one" },
        { path: "data/input.txt", content: "two" },
      ],
    };

    expect(() => OfflineAgentFixtureSchema.parse(fixture)).toThrow(
      "Duplicate portable fixture path",
    );
  });

  it.each([false, true])(
    "rejects file/directory conflicts regardless of declaration order (%s)",
    (reverse) => {
      const files = [
        { path: "Data", content: "file" },
        { path: "data/input.txt", content: "nested file" },
      ];
      const fixture = {
        ...baseFixture(),
        workspace: { files: reverse ? files.reverse() : files },
      };

      expect(() => OfflineAgentFixtureSchema.parse(fixture)).toThrow(
        "file as its parent directory",
      );
    },
  );

  it("bounds UTF-8 bytes per file, not only JavaScript string length", () => {
    expect(() =>
      OfflineAgentFixtureSchema.parse({
        ...baseFixture(),
        workspace: {
          files: [{ path: "中文.txt", content: "文".repeat(333_334) }],
        },
      }),
    ).toThrow("UTF-8 bytes");
  });

  it("bounds aggregate workspace size independently of the per-file limit", () => {
    expect(() =>
      OfflineAgentFixtureSchema.parse({
        ...baseFixture(),
        workspace: {
          files: Array.from({ length: 5 }, (_, index) => ({
            path: `file-${index}.txt`,
            content: "x".repeat(900_000),
          })),
        },
      }),
    ).toThrow("Fixture workspace exceeds");
  });

  it("rejects unknown and future fixture contracts", () => {
    expect(() =>
      OfflineAgentFixtureSchema.parse({
        ...baseFixture(),
        schemaVersion: 2,
      }),
    ).toThrow();
    expect(() =>
      OfflineAgentFixtureSchema.parse({
        ...baseFixture(),
        unexpected: true,
      }),
    ).toThrow("Unrecognized key");
  });

  it("rejects wait gates that the declarative runner cannot release", () => {
    expect(() =>
      OfflineAgentFixtureSchema.parse({
        ...baseFixture(),
        providerScenario: {
          schemaVersion: 1,
          id: "blocked",
          steps: [{ id: "wait", actions: [{ type: "wait", gate: "never" }] }],
        },
      }),
    ).toThrow("unreleased wait gates");
  });
});

function baseFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "fixture",
    prompt: "Inspect the fixture.",
    providerScenario: {
      schemaVersion: 1,
      id: "fixture-provider",
      steps: [{ id: "finish", actions: [{ type: "done" }] }],
    },
    expected: { status: "completed" },
  };
}
