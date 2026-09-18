import { describe, expect, it } from "vitest";
import { RiskClassifier } from "./RiskClassifier.js";

describe("RiskClassifier command analysis bounds", () => {
  it.each([
    "git push " + " ".repeat(100_000) + "x",
    "git checkout " + " ".repeat(100_000) + "x",
    "rm -" + "r".repeat(100_000) + "!",
    "echo " + "x".repeat(1024) + "; rm -rf ./build",
  ])(
    "classifies oversized input as dangerous without regex analysis",
    (command) => {
      expect(RiskClassifier.classifyBashCommand(command)).toBe("dangerous");
    },
  );

  it("keeps the limit inclusive and fails closed immediately above it", () => {
    expect(RiskClassifier.classifyBashCommand("x".repeat(1024))).toBe(
      "execute",
    );
    expect(RiskClassifier.classifyBashCommand("x".repeat(1025))).toBe(
      "dangerous",
    );
  });

  it.each([
    ["git status", "execute"],
    ["npm install", "network"],
    ["rm -rf ./build", "dangerous"],
    ["git push origin main --force", "dangerous"],
    ["git reset --hard", "dangerous"],
  ] as const)("preserves classification for %s", (command, risk) => {
    expect(RiskClassifier.classifyBashCommand(command)).toBe(risk);
  });
});
