import { describe, expect, it } from "vitest";
import { ConfigSchema } from "@orbit-build/config";
import { estimateTokenCount } from "@orbit-build/shared";
import {
  CodebaseContextRetriever,
  cleanCodebaseQuery,
  selectCodebaseRetrievalMode,
} from "./CodebaseContextRetriever.js";
import type { WorkspaceRetrievalService } from "./WorkspaceRetrievalService.js";

describe("CodebaseContextRetriever policy", () => {
  it("automatically retrieves for coding intent in English and Chinese", () => {
    expect(
      selectCodebaseRetrievalMode("Fix the session resume race", true),
    ).toBe("automatic");
    expect(
      selectCodebaseRetrievalMode("检查一下 solver.py 为什么报错", true),
    ).toBe("automatic");
  });

  it("keeps ordinary chat out of repository retrieval", () => {
    expect(selectCodebaseRetrievalMode("你好，今天怎么样？", true)).toBe("off");
    expect(selectCodebaseRetrievalMode("Fix the parser", false)).toBe("off");
  });

  it("supports explicit force and per-turn disable markers", () => {
    expect(selectCodebaseRetrievalMode("@codebase explain flow", false)).toBe(
      "explicit",
    );
    expect(
      selectCodebaseRetrievalMode("@codebase @no-codebase explain flow", true),
    ).toBe("off");
    expect(cleanCodebaseQuery("@codebase inspect @no-codebase parser")).toBe(
      "inspect parser",
    );
  });

  it("hard-bounds automatic search, references, and landmark context", async () => {
    let requestedRepoMapTokens = 0;
    const retrieval = {
      prepare: async (maxRepoMapTokens: number) => {
        requestedRepoMapTokens = maxRepoMapTokens;
        return {
          generation: 1,
          refreshing: false,
          repoMap: "landmark ".repeat(100_000),
          search: {
            load: async () => undefined,
            search: async () => [
              {
                id: "large-match",
                text: "relevant implementation detail ".repeat(100_000),
                metadata: {
                  filePath: "src/large.ts",
                  startLine: 1,
                  endLine: 2,
                },
                hybridScore: 1,
              },
            ],
          },
        };
      },
    } as Pick<WorkspaceRetrievalService, "prepare">;
    const retriever = new CodebaseContextRetriever(
      process.cwd(),
      retrieval as WorkspaceRetrievalService,
    );

    const context = await retriever.retrieve(
      "fix the parser regression",
      ConfigSchema.parse({}),
      "automatic",
    );

    expect(requestedRepoMapTokens).toBe(512);
    expect(estimateTokenCount(context)).toBeLessThanOrEqual(6_144);
    expect(context).toContain("Search Match #1");
    expect(context).toContain("Codebase Landmark Repo Map");
  });
});
