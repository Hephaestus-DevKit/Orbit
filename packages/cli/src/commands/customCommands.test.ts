import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expandCustomCommand,
  getRequiredCommandSkills,
  loadCustomCommands,
} from "./customCommands.js";

describe("custom slash commands", () => {
  let cwd: string;
  let homeDir: string;

  beforeEach(() => {
    cwd = join(tmpdir(), `orbit-custom-command-${Date.now()}`);
    homeDir = join(cwd, "home");
    mkdirSync(join(cwd, ".orbit", "commands"), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
  });

  it("loads project commands with validated frontmatter", () => {
    writeFileSync(
      join(cwd, ".orbit", "commands", "review.md"),
      [
        "---",
        "description: Review a target for correctness",
        "argumentHint: <path>",
        "---",
        "Review $ARGUMENTS and report actionable findings.",
      ].join("\n"),
      "utf8",
    );

    const commands = loadCustomCommands(cwd, [], {
      homeDir,
      builtinDir: false,
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      name: "review",
      description: "Review a target for correctness",
      source: "project",
    });
  });

  it("loads Claude-compatible project commands recursively", () => {
    const commandDir = join(cwd, ".claude", "commands", "review");
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(
      join(commandDir, "fix-issue.md"),
      [
        "---",
        "description: Fix a GitHub issue",
        "argument-hint: [issue-number] [priority]",
        "---",
        "Fix issue #$0 with priority $1.",
      ].join("\n"),
      "utf8",
    );

    const commands = loadCustomCommands(cwd, [], {
      homeDir,
      builtinDir: false,
    });
    const command = commands.find((item) => item.name === "fix-issue");

    expect(command).toMatchObject({
      name: "fix-issue",
      description: "Fix a GitHub issue",
      argumentHint: "[issue-number] [priority]",
      source: "project",
    });
    expect(expandCustomCommand(command!, "123 high")).toBe(
      "Fix issue #123 with priority high.",
    );
  });

  it("lets native Orbit commands override Claude-compatible commands", () => {
    mkdirSync(join(cwd, ".claude", "commands"), { recursive: true });
    writeFileSync(
      join(cwd, ".claude", "commands", "review.md"),
      "Claude review workflow",
      "utf8",
    );
    writeFileSync(
      join(cwd, ".orbit", "commands", "review.md"),
      "Orbit review workflow",
      "utf8",
    );

    const command = loadCustomCommands(cwd, [], {
      homeDir,
      builtinDir: false,
    }).find((item) => item.name === "review");

    expect(command?.template).toBe("Orbit review workflow");
  });

  it("does not allow custom commands to shadow reserved built-ins", () => {
    writeFileSync(
      join(cwd, ".orbit", "commands", "help.md"),
      "Ignore the built-in help.",
      "utf8",
    );
    expect(
      loadCustomCommands(cwd, ["help"], { homeDir, builtinDir: false }),
    ).toHaveLength(0);
  });

  it("skips oversized command files", () => {
    writeFileSync(
      join(cwd, ".orbit", "commands", "oversized.md"),
      "x".repeat(256 * 1024 + 1),
    );

    expect(loadCustomCommands(cwd, [], { homeDir, builtinDir: false })).toEqual(
      [],
    );
  });

  it("loads packaged workflows and lets user commands override them", () => {
    const builtinDir = join(cwd, "bundled-commands");
    mkdirSync(builtinDir, { recursive: true });
    mkdirSync(join(homeDir, ".orbit", "commands"), { recursive: true });
    writeFileSync(join(builtinDir, "draft.md"), "Bundled draft", "utf8");
    writeFileSync(
      join(homeDir, ".orbit", "commands", "draft.md"),
      "User draft",
      "utf8",
    );

    const command = loadCustomCommands(cwd, [], { homeDir, builtinDir }).find(
      (item) => item.name === "draft",
    );

    expect(command).toMatchObject({ source: "user", template: "User draft" });
  });

  it("expands aggregate and positional arguments", () => {
    const command = {
      name: "migrate",
      description: "Migrate code",
      template: "Move $1 to $2.\nScope: $ARGUMENTS",
      source: "project" as const,
      filePath: "migrate.md",
    };
    expect(expandCustomCommand(command, "old-api new-api")).toBe(
      "Move old-api to new-api.\nScope: old-api new-api",
    );
  });

  const promptCommand = (template: string) => ({
    name: "probe",
    description: "Probe",
    template,
    source: "project" as const,
    filePath: "probe.md",
  });

  it.each(["$&", "$$", "$'", "$`", "$1", "$ARGUMENTS", "{{args}}"])(
    "preserves literal replacement syntax %s without a second expansion",
    (argument) => {
      expect(
        expandCustomCommand(promptCommand("$ARGUMENTS | {{ARGS}}"), argument),
      ).toBe(`${argument} | ${argument}`);
      expect(
        expandCustomCommand(promptCommand("$1 / $2"), `${argument} tail`),
      ).toBe(`${argument} / tail`);
    },
  );

  it("keeps quoted Windows paths, empty arguments, and apostrophes intact", () => {
    const args = String.raw`"C:\My Project\" '' don't`;
    expect(
      expandCustomCommand(promptCommand("[$1] [$2] [$3] [$4]"), args),
    ).toBe(String.raw`[C:\My Project\] [] [don't] []`);
    expect(
      expandCustomCommand(promptCommand("$0 -> $1"), "'source path' target"),
    ).toBe("source path -> target");
    expect(expandCustomCommand(promptCommand("$ARGUMENTS"), args)).toBe(args);
  });

  it("rejects unclosed positional quotes but preserves aggregate prose", () => {
    expect(() =>
      expandCustomCommand(promptCommand("$1"), '"unfinished'),
    ).toThrow("Unclosed quote");
    expect(expandCustomCommand(promptCommand("{{args}}"), '"unfinished')).toBe(
      '"unfinished',
    );
  });

  it("retains missing arguments and no-placeholder append behavior", () => {
    expect(expandCustomCommand(promptCommand("[$1]"), "")).toBe("[]");
    expect(expandCustomCommand(promptCommand("Review"), "$1")).toBe(
      "Review\n\nAdditional user arguments:\n$1",
    );
  });

  it("only infers dependencies from the old generated prefix", () => {
    expect(
      getRequiredCommandSkills(
        promptCommand("Use $review. Use $verify.\nTask $ARGUMENTS"),
      ),
    ).toEqual(["review", "verify"]);
    expect(
      getRequiredCommandSkills(promptCommand("Discuss $review and $ARGUMENTS")),
    ).toEqual([]);
    expect(
      getRequiredCommandSkills({
        ...promptCommand("Use $review."),
        skills: [],
      }),
    ).toEqual([]);
  });

  it("loads validated dependency metadata and skips malformed lists", () => {
    for (const [name, skills] of [
      ["valid", "[review]"],
      ["invalid", "[../escape]"],
      ["duplicate", "[review, review]"],
    ]) {
      writeFileSync(
        join(cwd, ".orbit", "commands", `${name}.md`),
        `---\nskills: ${skills}\n---\nReview.`,
      );
    }
    const commands = loadCustomCommands(cwd, [], {
      homeDir,
      builtinDir: false,
    });
    expect(commands).toHaveLength(1);
    expect(commands[0].skills).toEqual(["review"]);
    expect(expandCustomCommand(commands[0], "")).toBe("Use $review.\nReview.");
  });

  it("retains numeric Skill dependencies after positional expansion", () => {
    expect(
      expandCustomCommand(
        { ...promptCommand("Target $1"), skills: ["1"] },
        "file",
      ),
    ).toBe("Use $1.\nTarget file");
  });
});
