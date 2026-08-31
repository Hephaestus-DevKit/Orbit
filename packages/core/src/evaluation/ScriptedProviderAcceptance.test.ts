import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type OrbitConfig } from "@orbit-build/config";
import { resolveSafePath } from "@orbit-build/shared";
import { AgentLoop, type UserInteraction } from "../agent/AgentLoop.js";
import {
  OfflineAgentFixtureSchema,
  type OfflineAgentFixture,
} from "./OfflineAgentFixture.js";
import { ScriptedModelProvider } from "./ScriptedModelProvider.js";

const processTestRoot = join(process.cwd(), "rag-test-temp");
const fixtureRoot = join(process.cwd(), "evals", "scenarios");
const fixtures = readdirSync(fixtureRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => loadFixture(join(fixtureRoot, entry.name)))
  .sort((left, right) => left.id.localeCompare(right.id));

describe("offline scripted provider acceptance catalog", () => {
  it("contains multiple independently replayable failure modes", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(
      fixtures.length,
    );
  });

  it.each(fixtures)(
    "replays $id through the real AgentLoop",
    async (fixture) => {
      mkdirSync(processTestRoot, { recursive: true });
      const cwd = mkdtempSync(join(processTestRoot, "scripted-acceptance-"));
      try {
        materializeWorkspace(cwd, fixture);
        const provider = new ScriptedModelProvider(fixture.providerScenario);
        const transcript: string[] = [];
        const interaction: UserInteraction = {
          askApproval: async () => true,
          showText: (text) => transcript.push(text),
          showDiff: () => undefined,
        };
        const loop = AgentLoop.initialize(
          cwd,
          config(fixture.providerScenario.provider.id),
          provider,
          fixture.prompt,
          interaction,
          { disableStatusBar: true },
        );

        const outcome = await loop.run();

        expect(outcome.status).toBe(fixture.expected.status);
        if (fixture.expected.maxAttempts !== undefined) {
          expect(outcome.attempts).toBeLessThanOrEqual(
            fixture.expected.maxAttempts,
          );
        }
        expect(provider.requests.map((request) => request.stepId)).toEqual(
          fixture.providerScenario.steps.map((step) => step.id),
        );
        expect(() => provider.assertExhausted()).not.toThrow();
        const visibleTranscript = transcript.join("\n");
        for (const fragment of fixture.expected.transcriptIncludes) {
          expect(visibleTranscript).toContain(fragment);
        }
      } finally {
        rmSync(cwd, {
          recursive: true,
          force: true,
          maxRetries: process.platform === "win32" ? 10 : 0,
          retryDelay: 100,
        });
      }
    },
  );
});

function loadFixture(path: string): OfflineAgentFixture {
  return OfflineAgentFixtureSchema.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
}

function materializeWorkspace(cwd: string, fixture: OfflineAgentFixture): void {
  for (const file of fixture.workspace.files) {
    const target = resolveSafePath(cwd, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf8");
  }
}

function config(providerId: string): OrbitConfig {
  return {
    ...DEFAULT_CONFIG,
    name: "scripted-provider-acceptance",
    provider: { default: providerId },
    providers: {
      ...DEFAULT_CONFIG.providers,
      [providerId]: {
        type: "openai-compatible",
        baseUrl: "https://example.invalid",
      },
    },
    models: {
      ...DEFAULT_CONFIG.models,
      default: "deepseek-v4-pro",
      coder: "deepseek-v4-pro",
      fast: "deepseek-v4-flash",
    },
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      mode: "auto",
      allowRead: true,
      protectSecrets: false,
    },
    tools: {
      ...DEFAULT_CONFIG.tools,
      bash: { ...DEFAULT_CONFIG.tools.bash, enabled: false },
      webSearch: { ...DEFAULT_CONFIG.tools.webSearch, enabled: false },
      mcp: { ...DEFAULT_CONFIG.tools.mcp, enabled: false },
    },
    context: {
      ...DEFAULT_CONFIG.context,
      autoCompact: false,
      autoRepair: false,
      maxFilesToIndex: 10,
    },
    autoCommit: false,
  };
}
