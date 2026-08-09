import type { IncomingMessage } from "http";
import { Readable } from "stream";
import { describe, expect, it } from "vitest";
import { WebUiRequestError } from "./WebUiErrors.js";
import { readBinaryBody, readJsonBody } from "./WebUiHttp.js";

function requestBody(...chunks: Array<string | Buffer>): IncomingMessage {
  return Readable.from(chunks) as IncomingMessage;
}

describe("WebUiHttp request boundaries", () => {
  it("returns a typed client error for malformed JSON", async () => {
    await expect(readJsonBody(requestBody('{"broken":'))).rejects.toEqual(
      expect.objectContaining({
        code: "invalid_json",
        statusCode: 400,
      }),
    );
  });

  it("returns typed payload errors independent of display text", async () => {
    await expect(
      readBinaryBody(requestBody(Buffer.alloc(5)), 4),
    ).rejects.toBeInstanceOf(WebUiRequestError);
    await expect(
      readBinaryBody(requestBody(Buffer.alloc(5)), 4),
    ).rejects.toMatchObject({
      code: "attachment_too_large",
      statusCode: 413,
    });
  });
});
