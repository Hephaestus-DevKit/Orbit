import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDoctorReport,
  buildDoctorSnapshot,
  DoctorSnapshotSchema,
  runDoctor,
} from "./doctor.js";
import {
  ConfigLoader,
  ConfigSchema,
  DEFAULT_CONFIG,
  type OrbitConfig,
} from "@orbit-build/config";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("doctor diagnostics", () => {
  it("applies an explicit provider override before probing or reporting", async () => {
    const loadConfig = vi
      .spyOn(ConfigLoader, "loadSync")
      .mockReturnValue(ConfigSchema.parse(DEFAULT_CONFIG));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runDoctor("D:/repo", { provider: "tokendance", json: true });

    expect(loadConfig).toHaveBeenCalledWith("D:/repo", {
      provider: { default: "tokendance" },
    });
  });

  it("summarizes capabilities without exposing secret values", () => {
    const config = {
      schemaVersion: 1,
      provider: { default: "deepseek-openai" },
      models: {
        default: "deepseek-v4-flash",
        fast: "deepseek-v4-flash",
        planner: "deepseek-v4-pro",
        coder: "deepseek-v4-pro",
        reviewer: "deepseek-v4-pro",
        summarizer: "deepseek-v4-flash",
        embedding: "text-embedding-3-small",
      },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          apiKey: "secret-deepseek-key",
        },
      },
      security: {
        trustProjectExecutables: false,
      },
      permissions: {
        mode: "normal",
        allowRead: true,
        requireApprovalForWrite: true,
        requireApprovalForBash: true,
        blockDangerousCommands: true,
        protectSecrets: true,
        protectedPaths: [],
      },
      context: {
        maxFilesToIndex: 5000,
        maxFileSizeKb: 512,
        ignore: [],
        autoCompact: true,
        compactThreshold: 0.75,
        autoRepair: false,
        testCommands: [],
      },
      agent: {
        maxIterations: 8,
        fastMaxOutputTokens: 8192,
        maxOutputTokens: 16384,
        teamPreset: "balanced",
        maxReviewAttempts: 3,
        maxReviewConcurrency: 2,
      },
      tools: {
        bash: { enabled: true, timeoutMs: 120000 },
        webSearch: {
          enabled: true,
          provider: "auto",
          searxngUrls: ["http://localhost:8080"],
          tavilyApiKeyEnv: "TAVILY_API_KEY",
          tavilyBaseUrl: "https://api.tavily.com/search",
          timeoutMs: 8000,
          maxResults: 8,
        },
        mcp: { enabled: false },
      },
      skills: {
        enabled: true,
        directories: [".orbit/skills", ".agents/skills"],
        activation: "auto",
        maxActive: 3,
        disabled: [],
        maxSkillBytes: 24000,
        maxAutoSkillBytes: 8000,
      },
      mcpServers: {},
      hooks: {},
      pricing: {},
      budgetLimit: 10,
      session: { store: "sqlite", path: ".orbit/sessions.sqlite" },
      autocomplete: {
        enabled: true,
        provider: "ollama",
        model: "qwen2.5-coder:1.5b",
        debounceMs: 150,
      },
      tui: { mouse: true, scrollSpeed: 50 },
      editor: "notepad.exe",
      autoCommit: false,
      language: "en",
      name: "orbit-project",
    } satisfies OrbitConfig;

    const report = buildDoctorReport("D:/repo", config, {
      exec: (command) => {
        if (command === "git --version") return "git version 2.50.0";
        if (command === "rg --version") return "ripgrep 14.1.1\nfeatures";
        if (command === "git status --short") return "";
        return "";
      },
      env: {
        TAVILY_API_KEY: "secret-tavily-key",
      },
      deepseek: true,
    });

    expect(report).toContain("Orbit Diagnostics");
    expect(report).toContain("DeepSeek V4 automatic-cache profile is active");
    expect(report).toContain("review attempts=3 · concurrency=2");
    expect(report).toContain("DeepSeek Official Alignment");
    expect(report).toContain(
      "No deprecated deepseek-chat/deepseek-reasoner aliases",
    );
    expect(report).toContain("DeepSeek V4 model roles");
    expect(report).toContain("Provider benchmark");
    expect(report).toContain("Realtime lookup enabled");
    expect(report).toContain("Skills:");
    expect(report).toContain("API key loaded from DEEPSEEK_API_KEY");
    expect(report).not.toContain("secret-deepseek-key");
    expect(report).not.toContain("secret-tavily-key");
  });

  it("gives an actionable failure when the provider key is missing", () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKeyEnv: "DEEPSEEK_API_KEY",
        },
      },
    });

    const report = buildDoctorReport("D:/repo", config, {
      exec: () => "",
      env: {},
    });

    expect(report).toContain("API key not found in DEEPSEEK_API_KEY");
    expect(report).toContain("run `orbit login`");
    expect(report).not.toContain("API key loaded from DEEPSEEK_API_KEY");
  });

  it("builds a versioned, path-redacted machine-readable support snapshot", () => {
    const config = ConfigSchema.parse({
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          baseUrl:
            "https://private-user:private-password@api.deepseek.com?api_key=private-query",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          apiKey: "private-provider-secret",
        },
      },
    });

    const snapshot = buildDoctorSnapshot(
      "D:/Customers/PrivateProject",
      config,
      {
        exec: (command) => {
          if (command === "git --version") return "git version 2.50.0";
          if (command === "rg --version") return "ripgrep 14.1.1\nfeatures";
          if (command === "git status --short") return " M src/index.ts";
          return "";
        },
        env: {},
        providerProbeText: "Bearer private-probe-token",
        providerProbeOk: false,
      },
    );

    expect(DoctorSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.workspace).toEqual({
      name: "PrivateProject",
      pathRedacted: true,
    });
    expect(snapshot.runtime.gitDirty).toBe(true);
    expect(snapshot.status).toBe("error");
    expect(snapshot.issues.map((issue) => issue.code)).toContain(
      "provider.probe.failed",
    );
    expect(JSON.stringify(snapshot)).not.toMatch(
      /Customers|private-user|private-password|private-query|private-provider-secret|private-probe-token/,
    );
  });

  it("accepts an explicitly declared DeepSeek-compatible gateway", () => {
    const config = ConfigSchema.parse({
      provider: { default: "gateway" },
      providers: {
        gateway: {
          type: "openai-compatible",
          baseUrl: "https://gateway.example/v1",
          apiKey: "private-gateway-key",
          deepSeekApiFormat: "chat-completions",
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        },
      },
    });

    const snapshot = buildDoctorSnapshot("D:/repo", config, {
      exec: (command) => {
        if (command === "git --version") return "git version 2.50.0";
        if (command === "rg --version") return "ripgrep 14.1.1\nfeatures";
        if (command === "git status --short") return "";
        return "";
      },
      env: {},
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.provider.deepSeekProfile).toBe(true);
    expect(snapshot.issues).not.toContainEqual(
      expect.objectContaining({
        code: "provider.deepseek.endpoint_nonofficial",
      }),
    );
  });

  it("warns when a compatible DeepSeek gateway has no declared API format", () => {
    const config = ConfigSchema.parse({
      provider: { default: "gateway" },
      providers: {
        gateway: {
          type: "openai-compatible",
          baseUrl: "https://gateway.example/v1",
          apiKey: "private-gateway-key",
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        },
      },
    });

    const snapshot = buildDoctorSnapshot("D:/repo", config, {
      exec: (command) => {
        if (command === "git --version") return "git version 2.50.0";
        if (command === "rg --version") return "ripgrep 14.1.1\nfeatures";
        if (command === "git status --short") return "";
        return "";
      },
      env: {},
    });

    expect(snapshot.status).toBe("warning");
    expect(snapshot.issues).toContainEqual(
      expect.objectContaining({
        code: "provider.deepseek.endpoint_nonofficial",
      }),
    );
  });
});
