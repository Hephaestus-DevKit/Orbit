import { describe, expect, it } from "vitest";
import { ConfigSchema } from "@orbit-build/config";
import {
  getActiveSlashMatches,
  getSlashMatchHint,
  type SlashCompletionContext,
} from "./TuiSlashCompletion.js";
function context(input: string): SlashCompletionContext {
  return {
    input,
    hidden: false,
    config: ConfigSchema.parse({}),
    candidates: {
      commands: ["/add", "/chat"],
      commandDetails: [],
      files: ["src/main.ts"],
      sessions: ["session-one"],
    },
  };
}
describe("terminal slash completion", () => {
  it("keeps read-only file flags and filters non-command input", () => {
    expect(getActiveSlashMatches(context("/add --read-only main"))).toContain(
      "/add --read-only src/main.ts",
    );
    expect(getActiveSlashMatches(context("ordinary text"))).toEqual([]);
    expect(getActiveSlashMatches({ ...context("/add"), hidden: true })).toEqual(
      [],
    );
  });
  it("uses the session catalog and localized descriptions", () => {
    expect(getActiveSlashMatches(context("/chat switch one"))).toContain(
      "/chat switch session-one",
    );
    const ctx = context("/chat");
    ctx.config!.language = "zh";
    expect(getSlashMatchHint(ctx, "/chat switch session-one")).toBe(
      "切换到该聊天",
    );
  });
});
