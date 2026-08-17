import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  readLocalRuntimeState,
  writeLocalRuntimeState,
} from "./LocalRuntimeState.js";

describe("LocalRuntimeState", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createWorkspace(): string {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-local-state-"));
    temporaryDirectories.push(cwd);
    return cwd;
  }

  it("round-trips provider, model, language, session, and Skills state", () => {
    const cwd = createWorkspace();
    writeLocalRuntimeState(cwd, {
      lastSessionId: "session-one",
      language: "zh",
      permissionMode: "auto",
      agentMaxIterations: 500,
      agentProfile: "reviewer",
    });
    writeLocalRuntimeState(cwd, {
      lastProvider: "provider-b",
      lastModel: "model-b",
      skills: {
        enabled: true,
        activation: "explicit",
        maxActive: 2,
        disabled: ["noisy-skill"],
      },
    });

    expect(readLocalRuntimeState(cwd)).toEqual({
      lastSessionId: "session-one",
      lastProvider: "provider-b",
      lastModel: "model-b",
      language: "zh",
      permissionMode: "auto",
      agentMaxIterations: 500,
      agentProfile: "reviewer",
      skills: {
        enabled: true,
        activation: "explicit",
        maxActive: 2,
        disabled: ["noisy-skill"],
      },
    });
    expect(readFileSync(join(cwd, ".orbit", "state.json"), "utf8")).toMatch(
      /\n$/,
    );
  });

  it("returns an empty state for malformed or oversized external input", () => {
    const cwd = createWorkspace();
    const stateDirectory = join(cwd, ".orbit");
    const statePath = join(stateDirectory, "state.json");
    mkdirSync(stateDirectory);
    writeFileSync(statePath, "{invalid");
    expect(readLocalRuntimeState(cwd)).toEqual({});

    writeFileSync(statePath, "x".repeat(1_048_577));
    expect(readLocalRuntimeState(cwd)).toEqual({});
  });

  it("rejects unsafe state paths without replacing them", () => {
    const cwd = createWorkspace();
    const statePath = join(cwd, ".orbit", "state.json");
    mkdirSync(statePath, { recursive: true });

    expect(() => writeLocalRuntimeState(cwd, { lastModel: "model-b" })).toThrow(
      "regular file",
    );
    expect(readLocalRuntimeState(cwd)).toEqual({});
  });
});
