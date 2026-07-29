import { describe, expect, it } from "vitest";
import {
  readResponseJsonWithinLimit,
  readResponseTextWithinLimit,
} from "./httpResponse.js";

describe("bounded HTTP responses", () => {
  it("reads text and JSON within the byte limit", async () => {
    await expect(
      readResponseTextWithinLimit(new Response("hello"), 5),
    ).resolves.toBe("hello");
    await expect(
      readResponseJsonWithinLimit(new Response('{"ok":true}'), 32),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects declared and streamed oversized responses", async () => {
    await expect(
      readResponseTextWithinLimit(
        new Response("small", { headers: { "content-length": "100" } }),
        10,
      ),
    ).rejects.toThrow(/10-byte limit/);

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.enqueue(new TextEncoder().encode("67890"));
        controller.close();
      },
    });
    await expect(
      readResponseTextWithinLimit(new Response(body), 9),
    ).rejects.toThrow(/9-byte limit/);
  });

  it("releases the stream reader when the response fails mid-read", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
          controller.error(new Error("connection reset"));
        },
      }),
    );

    await expect(
      readResponseTextWithinLimit(response, 1024, "broken response"),
    ).rejects.toThrow("connection reset");
    expect(response.body?.locked).toBe(false);
  });
});
