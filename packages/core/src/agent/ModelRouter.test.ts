import { describe, expect, it } from "vitest";
import { classifyTaskComplexity, routeModel } from "./ModelRouter.js";

const base = {
  defaultModel: "deepseek-v4-flash",
  fastModel: "deepseek-v4-flash",
  qualityModel: "deepseek-v4-pro",
};

describe("routeModel", () => {
  it("honors an explicit user lock", () => {
    expect(
      routeModel({ ...base, query: "refactor", lockedModel: "custom" }),
    ).toMatchObject({
      model: "custom",
      lane: "locked",
      reason: "user_locked",
    });
  });

  it("keeps task complexity independent from a locked model lane", () => {
    expect(
      classifyTaskComplexity({ query: "debug and refactor this architecture" }),
    ).toBe("complex");
    expect(
      routeModel({
        ...base,
        query: "debug and refactor this architecture",
        lockedModel: "deepseek-chat",
      }).lane,
    ).toBe("locked");
  });

  it("routes complex and repair work to the quality lane", () => {
    expect(routeModel({ ...base, query: "分析并重构并发架构" })).toMatchObject({
      model: "deepseek-v4-pro",
      reason: "complex_request",
    });
    expect(
      routeModel({ ...base, query: "retry", repairTurn: true }),
    ).toMatchObject({
      model: "deepseek-v4-pro",
      reason: "verification_repair",
    });
  });

  it("uses the fast lane for small reads and escalates multi-file writes", () => {
    expect(routeModel({ ...base, query: "list files" }).model).toBe(
      "deepseek-v4-flash",
    );
    expect(
      routeModel({
        ...base,
        query: "continue",
        activeModel: "deepseek-v4-flash",
        hasWrittenFiles: true,
        affectedFileCount: 3,
      }),
    ).toMatchObject({ model: "deepseek-v4-pro", reason: "write_escalation" });
  });

  it("does not mistake every short prompt or single-file edit for complex work", () => {
    expect(classifyTaskComplexity({ query: "fix race condition" })).toBe(
      "complex",
    );
    expect(
      classifyTaskComplexity({
        query: "continue",
        hasWrittenFiles: true,
        affectedFileCount: 1,
      }),
    ).toBe("balanced");
  });
});
