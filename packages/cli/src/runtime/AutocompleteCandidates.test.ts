import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getAutocompleteCandidates } from "./AutocompleteCandidates.js";

describe("getAutocompleteCandidates", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-autocomplete-"));
    mkdirSync(join(cwd, "src"));
    mkdirSync(join(cwd, ".orbit", "commands"), { recursive: true });
    mkdirSync(join(cwd, ".orbit", "sessions", "session-1"), {
      recursive: true,
    });
    writeFileSync(join(cwd, "src", "index.ts"), "export {};\n");
    writeFileSync(join(cwd, "src", "ignored.tmp"), "ignored\n");
    writeFileSync(
      join(cwd, ".orbit", "commands", "release-review.md"),
      "---\ndescription: Review this release\nargument-hint: <scope>\n---\nReview $1",
    );
    writeFileSync(
      join(cwd, ".orbit", "symbols.json"),
      JSON.stringify({
        files: {
          "src/index.ts": {
            symbols: [{ name: "main" }, { name: "main" }],
          },
        },
      }),
    );
    writeFileSync(
      join(cwd, ".orbit", "sessions", "session-1", "session.json"),
      "{}",
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("collects validated and de-duplicated workspace candidates", async () => {
    const candidates = await getAutocompleteCandidates(cwd, {
      context: { ignore: ["**/*.tmp"] },
    });

    expect(candidates.commands).toContain("/help");
    expect(candidates.commands).toContain("/review");
    expect(candidates.commandDetails).toContainEqual({
      command: "/release-review",
      description: "Review this release",
      argumentHint: "<scope>",
      source: "project",
    });
    expect(candidates.files).toContain("src/index.ts");
    expect(candidates.files).not.toContain("src/ignored.tmp");
    expect(candidates.symbols).toEqual(["main"]);
    expect(candidates.sessions).toEqual(["session-1"]);
  });

  it("ignores malformed symbol indexes without losing other candidates", async () => {
    writeFileSync(join(cwd, ".orbit", "symbols.json"), "not-json");
    const candidates = await getAutocompleteCandidates(cwd, {});
    expect(candidates.commands).toContain("/help");
    expect(candidates.symbols).toEqual([]);
  });

  it("loads sessions from the configured workspace-safe directory", async () => {
    const customSession = join(cwd, ".orbit", "custom-sessions", "session-2");
    mkdirSync(customSession, { recursive: true });
    writeFileSync(join(customSession, "session.json"), "{}");

    const candidates = await getAutocompleteCandidates(cwd, {
      session: { path: ".orbit/custom-sessions" },
    });

    expect(candidates.sessions).toEqual(["session-2"]);
  });
});
