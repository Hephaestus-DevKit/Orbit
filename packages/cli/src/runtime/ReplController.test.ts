import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type http from "http";
import {
  formatScreenReaderHeader,
  ReplController,
  shouldUseFullscreenTui,
} from "./ReplController.js";

describe("ReplController Instantiation and Completer Tests", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const mockConfig = {
    language: "en",
    permissions: { mode: "strict" },
    models: {
      default: "gpt-4",
      planner: "planner-model",
      coder: "coder-model",
      reviewer: "reviewer-model",
      fast: "fast-model",
    },
    autocomplete: { enabled: false },
    session: { store: "jsonl", path: ".orbit/test-sessions" },
  };

  const mockProvider = {
    id: "openai",
    chat: vi.fn(),
  };

  const mockInteraction = {
    askApproval: vi.fn(),
    showText: vi.fn(),
    showDiff: vi.fn(),
  };

  it("routes screen-reader sessions to the line-oriented terminal", () => {
    const interactive = {
      stdinIsTty: true,
      hasRawMode: true,
      direct: false,
      webUiOnly: false,
      accessibility: "standard" as const,
    };
    expect(shouldUseFullscreenTui(interactive)).toBe(true);
    expect(
      shouldUseFullscreenTui({
        ...interactive,
        accessibility: "screen-reader",
      }),
    ).toBe(false);
    expect(shouldUseFullscreenTui({ ...interactive, direct: true })).toBe(
      false,
    );
    expect(shouldUseFullscreenTui({ ...interactive, stdinIsTty: false })).toBe(
      false,
    );
  });

  it("formats a stable screen-reader header without ANSI controls", () => {
    const header = formatScreenReaderHeader(
      "sess_1234567890",
      "deepseek-v4-pro",
      "C:/repo",
      "v1.6.0",
    );
    expect(header).toContain("Session: sess_123");
    expect(header).toContain("Model: deepseek-v4-pro");
    expect(header).not.toMatch(/\x1b/);
  });

  it("should instantiate ReplController successfully", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-repl-controller-"));
    temporaryDirectories.push(cwd);
    const controller = new ReplController(
      cwd,
      mockConfig,
      mockProvider,
      mockInteraction as any,
      false,
      true,
    );
    expect(controller).toBeDefined();
    expect(controller.start).toBeDefined();
  });

  it("protects the autocomplete bridge with a discovery token", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-autocomplete-server-"));
    temporaryDirectories.push(cwd);
    const controller = new ReplController(
      cwd,
      { ...mockConfig, autocomplete: { enabled: true } },
      mockProvider,
      mockInteraction as any,
    );
    const server = (
      controller as unknown as { startAutocompleteServer(): http.Server }
    ).startAutocompleteServer();
    if (!server.listening) {
      await new Promise<void>((resolve) => server.once("listening", resolve));
    }

    const endpointPath = join(cwd, ".orbit", "autocomplete.json");
    expect(existsSync(endpointPath)).toBe(true);
    const endpoint = JSON.parse(readFileSync(endpointPath, "utf8")) as {
      port: number;
      token: string;
    };
    const url = `http://127.0.0.1:${endpoint.port}/autocomplete`;

    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${endpoint.token}`,
            Origin: "https://attacker.invalid",
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${endpoint.token}`,
            "Content-Type": "text/plain",
          },
          body: "{}",
        })
      ).status,
    ).toBe(415);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(existsSync(endpointPath)).toBe(false);
  });
});
