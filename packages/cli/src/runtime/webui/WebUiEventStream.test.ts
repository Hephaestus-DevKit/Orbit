import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebUiEventStream } from "./WebUiEventStream.js";

describe("WebUiEventStream", () => {
  let stream: WebUiEventStream | undefined;

  afterEach(() => {
    stream?.stop();
    stream = undefined;
    vi.restoreAllMocks();
  });

  it("keeps SSE alive when only the request side closes", () => {
    const request = new EventEmitter() as unknown as IncomingMessage;
    const response = new EventEmitter() as unknown as ServerResponse;
    Object.assign(response, {
      destroyed: false,
      writeHead: vi.fn(),
      write: vi.fn(() => true),
      end: vi.fn(),
      destroy: vi.fn(),
    });

    stream = new WebUiEventStream(() => undefined);
    stream.start();
    stream.attach(request, response);

    expect(response.write).toHaveBeenCalledTimes(1);
    request.emit("close");
    stream.broadcast({ kind: "regression", message: "still connected" });
    expect(response.write).toHaveBeenCalledTimes(2);
    expect(response.write).toHaveBeenLastCalledWith(
      expect.stringContaining("still connected"),
    );

    request.emit("aborted");
    stream.broadcast({ kind: "regression", message: "must not arrive" });
    expect(response.write).toHaveBeenCalledTimes(2);
  });

  it("replays bounded events after an EventSource reconnect", () => {
    stream = new WebUiEventStream(() => undefined);
    stream.start();
    stream.broadcast({ kind: "turn_done", turnId: "turn-1" });

    const request = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(request, { headers: { "last-event-id": "0" } });
    const response = new EventEmitter() as unknown as ServerResponse;
    Object.assign(response, {
      destroyed: false,
      writeHead: vi.fn(),
      write: vi.fn(() => true),
      end: vi.fn(),
      destroy: vi.fn(),
    });

    stream.attach(request, response);

    expect(response.write).toHaveBeenCalledTimes(2);
    expect(response.write).toHaveBeenLastCalledWith(
      expect.stringMatching(/id: 1\ndata: .*turn-1/),
    );
  });

  it("reports a replay gap instead of silently presenting an incomplete stream", () => {
    stream = new WebUiEventStream(() => undefined);
    stream.start();
    for (let index = 0; index < 300; index += 1) {
      stream.broadcast({ kind: "turn_progress", index });
    }

    const request = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(request, { headers: { "last-event-id": "1" } });
    const response = new EventEmitter() as unknown as ServerResponse;
    Object.assign(response, {
      destroyed: false,
      writeHead: vi.fn(),
      write: vi.fn(() => true),
      end: vi.fn(),
      destroy: vi.fn(),
    });

    stream.attach(request, response);

    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining('"kind":"replay_gap"'),
    );
  });
});
