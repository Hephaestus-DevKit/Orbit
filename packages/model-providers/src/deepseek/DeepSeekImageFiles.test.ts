import {
  afterEach,
  describe,
  expect,
  it,
  mockTools as vi,
} from "../../../../scripts/testing/support.mjs";
import { DeepSeekImageFiles, deepSeekImageFileId } from "./DeepSeekImageFiles.js";
import { DeepSeekProvider } from "./DeepSeekProvider.js";
import type { ModelChatInput } from "../types.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const input = (): ModelChatInput => ({
  model: "deepseek-flash",
  stream: false,
  messages: [
    {
      role: "user",
      id: "image",
      createdAt: "2026-10-21T00:00:00Z",
      content: [{ type: "image", mediaType: "image/png", data: "aW1hZ2U=" }],
    },
  ],
});
const upload = () => Response.json({ id: "file-api-fixture" });

describe("DeepSeek image reuse", () => {
  it.each(["chat-completions", "responses", "anthropic"] as const)(
    "rejects invalid %s history before uploading attachments",
    async (format) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const request = input();
      request.messages.push({
        id: "pending",
        role: "assistant",
        createdAt: "2026-11-17T00:00:00Z",
        content: [
          {
            type: "tool_call",
            toolCall: { id: "unresolved", name: "read_file", arguments: "{}" },
          },
        ],
      });
      const provider = new DeepSeekProvider(
        "fixture",
        "https://api.deepseek.com",
        {
          deepSeekFiles: true,
          deepSeekApiFormat: format,
          disablePreheat: true,
        },
      );
      const events = [];
      for await (const event of provider.chat(request)) events.push(event);
      expect(events).toMatchObject([{ type: "error" }]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("reuses identical bytes, isolates credentials, expires entries and keeps references out of history", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => upload());
    vi.stubGlobal("fetch", fetch);
    const files = new DeepSeekImageFiles();
    const original = input();
    const projected = await files.prepare(original, "first-key");
    expect(deepSeekImageFileId(projected.messages[0].content[0])).toBe(
      "file-api-fixture",
    );
    expect(
      deepSeekImageFileId(original.messages[0].content[0]),
    ).toBeUndefined();
    expect(JSON.stringify(projected)).toBe(JSON.stringify(original));
    await files.prepare(input(), "first-key");
    expect(fetch).toHaveBeenCalledTimes(1);
    const form = fetch.mock.calls[0][1].body as FormData;
    expect(form.get("expires_after[seconds]")).toBe("3600");
    await files.prepare(input(), "rotated-key");
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3600_000);
    await files.prepare(input(), "first-key");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each(["chat-completions", "responses", "anthropic"] as const)(
    "projects %s file references and retries stale IDs only once inline",
    async (format) => {
      const fetch = vi
        .fn()
        .mockImplementation(async (url: string, init: RequestInit) => {
          if (url.endsWith("/files")) return upload();
          const body = String(init.body);
          if (body.includes("file-api-fixture"))
            return Response.json(
              { error: { message: "file-api-fixture expired" } },
              { status: 400 },
            );
          if (format === "anthropic")
            return Response.json({
              content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn",
            });
          if (format === "responses")
            return Response.json({
              id: "response",
              status: "completed",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "ok" }],
                },
              ],
            });
          return Response.json({
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          });
        });
      vi.stubGlobal("fetch", fetch);
      const provider = new DeepSeekProvider("key", "https://api.deepseek.com", {
        deepSeekFiles: true,
        deepSeekApiFormat: format,
        maxRetries: 0,
        disablePreheat: true,
      });
      const events = [];
      for await (const event of provider.chat(input())) events.push(event);
      expect(events.some((event) => event.type === "text_delta")).toBe(true);
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(String(fetch.mock.calls[1][1].body)).toContain("file-api-fixture");
      expect(String(fetch.mock.calls[2][1].body)).toContain("aW1hZ2U=");
      if (format === "anthropic")
        expect(fetch.mock.calls[1][1].headers).toMatchObject({
          "anthropic-beta": "files-api-2025-04-14",
        });
    },
  );
  it("falls back inline on upload failure and stops before model transport on cancellation", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("/files")
        ? new Response("unavailable", { status: 503 })
        : Response.json({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        })
    );
    vi.stubGlobal("fetch", fetch);
    const provider = new DeepSeekProvider("key", "https://api.deepseek.com", {
      deepSeekFiles: true,
      disablePreheat: true,
      maxRetries: 0,
    });
    for await (const event of provider.chat(input())) void event;
    expect(fetch).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    controller.abort();
    for await (const event of provider.chat({
      ...input(),
      abortSignal: controller.signal,
    }))
      void event;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
