import type { IncomingMessage } from "http";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  isAuthorizedWebRequest,
  isAuthorizedWebEventRequest,
  safeWebMessage,
  sanitizeBaseUrl,
  sanitizeProjectActionResult,
  sanitizeWebEventPayload,
  summarizeWebToolValue,
  webRequestErrorStatus,
} from "./WebUiSecurity.js";

function requestWithHeaders(
  headers: IncomingMessage["headers"],
): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("WebUiSecurity", () => {
  it("allowlists event fields and redacts browser-facing text", () => {
    expect(
      sanitizeWebEventPayload("tool_proposal", {
        toolCallId: "tool-1",
        toolName: "bash",
        explanation: "Bearer private-token",
        arguments: { apiKey: "must-not-leak" },
      }),
    ).toEqual({
      toolCallId: "tool-1",
      toolName: "bash",
      explanation: "Bearer ***REDACTED***",
    });
    expect(
      sanitizeWebEventPayload("untrusted_event", { private: true }),
    ).toBeUndefined();
    expect(
      sanitizeWebEventPayload("tool_result", {
        toolCallId: "tool-1",
        toolName: "web_search",
        display:
          "Web search returned 5 results via Tavily Bearer private-token",
        result: "must not reach the browser",
      }),
    ).toEqual({
      toolCallId: "tool-1",
      toolName: "web_search",
      display: "Web search returned 5 results via Tavily Bearer ***REDACTED***",
      error: "",
    });
    expect(
      sanitizeWebEventPayload("ui_turn_started", {
        turnId: "terminal-turn",
        source: "terminal",
        prompt: "Use Bearer private-token",
      }),
    ).toEqual({
      turnId: "terminal-turn",
      source: "terminal",
      prompt: "Use Bearer ***REDACTED***",
    });
    expect(
      sanitizeWebEventPayload("agent_completed", {
        taskId: "internal-agent",
        success: false,
        error: "Bearer private-token",
        result: { private: true },
      }),
    ).toEqual({
      taskId: "internal-agent",
      success: false,
      error: "Bearer ***REDACTED***",
    });
    expect(
      sanitizeWebEventPayload("web_approval_requested", {
        approvalId: "approval-1",
        kind: "change",
        title: "Bearer private-token",
        preview: "must not cross the event stream",
        agentId: "agent_security-1",
        agentRole: "Bearer private-token",
      }),
    ).toEqual({
      approvalId: "approval-1",
      kind: "change",
      title: "Bearer ***REDACTED***",
      toolCallId: "",
      agentId: "agent_security-1",
      agentRole: "Bearer ***REDACTED***",
    });
    expect(
      sanitizeWebEventPayload("background_task_completed", {
        taskId: "bg_0123456789abcdef",
        sessionId: "session-a",
        command: "echo Bearer private-token",
        cwd: "C:/private/workspace",
        status: "completed",
        durationMs: 120,
        exitCode: 0,
        outputTruncated: false,
      }),
    ).toEqual({
      taskId: "bg_0123456789abcdef",
      sessionId: "session-a",
      status: "completed",
      durationMs: 120,
      exitCode: 0,
      outputTruncated: false,
    });
    expect(
      sanitizeWebEventPayload("agent_input_queued", {
        inputId: "input_web_1",
        sessionId: "sess-a",
        mode: "steer",
        source: "web",
        remaining: 2,
        prompt: "Bearer private-token",
      }),
    ).toEqual({
      inputId: "input_web_1",
      sessionId: "sess-a",
      mode: "steer",
      source: "web",
      remaining: 2,
    });
    expect(
      sanitizeWebEventPayload("agent_input_moved", {
        inputId: "input_web_1",
        sessionId: "sess-a",
        mode: "follow_up",
        source: "web",
        remaining: 2,
        fromIndex: 1,
        toIndex: 0,
        prompt: "Bearer private-token",
      }),
    ).toEqual({
      inputId: "input_web_1",
      sessionId: "sess-a",
      mode: "follow_up",
      source: "web",
      remaining: 2,
      fromIndex: 1,
      toIndex: 0,
    });
  });

  it("forwards file_diff events with redaction and a bounded size", () => {
    expect(
      sanitizeWebEventPayload("file_diff", {
        filePath: "src/app.ts",
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old Bearer private-token\n+new",
        extra: "dropped",
      }),
    ).toEqual({
      filePath: "src/app.ts",
      diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old Bearer ***REDACTED***\n+new",
    });
    const oversized = sanitizeWebEventPayload("file_diff", {
      filePath: "big.txt",
      diff: "+x\n".repeat(40_000),
    });
    expect(String(oversized?.diff).length).toBeLessThanOrEqual(48_000);
  });

  it("exposes only bounded explainable model-routing fields", () => {
    expect(
      sanitizeWebEventPayload("model_routing", {
        model: "deepseek-v4-pro",
        lane: "quality",
        reason: "complex_request",
        confidence: "high",
        secret: "do-not-forward",
      }),
    ).toEqual({
      model: "deepseek-v4-pro",
      lane: "quality",
      reason: "complex_request",
      confidence: "high",
    });
  });

  it("removes URL credentials, queries, and fragments", () => {
    expect(
      sanitizeBaseUrl(
        "https://user:password@example.com/v1?api_key=private#secret",
      ),
    ).toBe("https://example.com/v1");
  });

  it("preserves only bounded fields from a native project picker", () => {
    expect(
      sanitizeProjectActionResult({
        ok: true,
        path: "C:/work/project",
        url: "http://127.0.0.1:6123/#token=abcdefghijklmnopqrstuvwxyz123456",
        cancelled: false,
      }),
    ).toEqual({
      ok: true,
      path: "C:/work/project",
      url: "http://127.0.0.1:6123/#token=abcdefghijklmnopqrstuvwxyz123456",
    });
    expect(sanitizeProjectActionResult({ ok: true, cancelled: true })).toEqual({
      ok: true,
      cancelled: true,
    });
    expect(
      sanitizeProjectActionResult({
        ok: true,
        url: "https://attacker.invalid/#token=abcdefghijklmnopqrstuvwxyz123456",
      }),
    ).toEqual({ ok: true });
    for (const url of [
      "http://127.0.0.1/#token=abcdefghijklmnopqrstuvwxyz123456",
      "http://127.0.0.1:6123/project#token=abcdefghijklmnopqrstuvwxyz123456",
      "http://127.0.0.1:6123/?next=project#token=abcdefghijklmnopqrstuvwxyz123456",
      "http://127.0.0.1:6123/#token=abcdefghijklmnopqrstuvwxyz123456&extra=value",
      "http://127.0.0.1:6123/#token=abcdefghijklmnopqrstuvwxyz123456&token=duplicate123456789012345678901234",
    ]) {
      expect(sanitizeProjectActionResult({ ok: true, url })).toEqual({
        ok: true,
      });
    }
  });

  it("summarizes only safe tool fields and redacts plain errors", () => {
    expect(
      summarizeWebToolValue({
        path: "src/index.ts",
        query: "Orbit",
        content: "private file content",
        apiKey: "private-token",
      }),
    ).toBe("path: src/index.ts\nquery: Orbit");
    expect(
      summarizeWebToolValue("password=hunter2 request failed", {
        allowPlainText: true,
      }),
    ).toBe("password=***REDACTED*** request failed");
  });

  it("requires a matching token and same-origin request", () => {
    expect(
      isAuthorizedWebRequest(
        requestWithHeaders({
          host: "127.0.0.1:6047",
          origin: "http://127.0.0.1:6047",
          authorization: "Bearer expected-token",
        }),
        "expected-token",
      ),
    ).toBe(true);
    expect(
      isAuthorizedWebRequest(
        requestWithHeaders({
          host: "127.0.0.1:6047",
          origin: "https://attacker.invalid",
          authorization: "Bearer expected-token",
        }),
        "expected-token",
      ),
    ).toBe(false);
  });

  it("allows a matching capability only on the SSE transport fallback", () => {
    const request = requestWithHeaders({
      host: "127.0.0.1:6047",
      origin: "http://127.0.0.1:6047",
    });
    expect(
      isAuthorizedWebEventRequest(
        request,
        "expected-token",
        new URL("http://127.0.0.1:6047/api/events?access_token=expected-token"),
      ),
    ).toBe(true);
    expect(
      isAuthorizedWebEventRequest(
        request,
        "expected-token",
        new URL("http://127.0.0.1:6047/api/events?access_token=wrong-token"),
      ),
    ).toBe(false);
  });

  it("maps validation and size failures without leaking raw errors", () => {
    const validationError = z.string().safeParse(42).error;
    expect(webRequestErrorStatus(validationError)).toBe(400);
    expect(webRequestErrorStatus(new Error("Request body too large."))).toBe(
      413,
    );
    expect(safeWebMessage(new Error("Bearer private-token"))).toBe(
      "Bearer ***REDACTED***",
    );
  });
});
