import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedApi } from "./WebUiClientTransport.js";

function harness() {
  let bearer = false;
  const fetchImpl = vi.fn<typeof fetch>();
  const recover = vi.fn(async () => {
    bearer = false;
    return true;
  });
  const api = createAuthenticatedApi({
    getToken: () => "fixture-token",
    getUseBearer: () => bearer,
    setUseBearer: (value) => {
      bearer = value;
    },
    recoverAuthenticatedSession: recover,
    accessExpired: "Access expired",
    fetchImpl,
  });
  return { api, fetchImpl, recover };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("authenticated browser API", () => {
  it("keeps credentials local and handles tuple and Headers request headers", async () => {
    const { api, fetchImpl } = harness();
    fetchImpl.mockResolvedValueOnce(json({ ok: true }));
    await api("/api/status", { headers: [["X-Test", "kept"]] });
    const options = fetchImpl.mock.calls[0]![1]!;
    expect(options.credentials).toBe("same-origin");
    expect(new Headers(options.headers).get("X-Test")).toBe("kept");
    expect(new Headers(options.headers).get("Accept")).toBe("application/json");
    await expect(api("https://other.example/api/status")).rejects.toThrow(
      "local API",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("recovers expired cookies once without losing the original request", async () => {
    const { api, fetchImpl, recover } = harness();
    fetchImpl
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ ok: true }));
    await expect(
      api("/api/input-queue", { method: "POST", body: "request" }),
    ).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(recover).toHaveBeenCalledOnce();
    expect(
      new Headers(fetchImpl.mock.calls[1]![1]!.headers).get("Authorization"),
    ).toBe("Bearer fixture-token");
    for (const [, options] of fetchImpl.mock.calls)
      expect(options?.body).toBe("request");
  });
  it("returns an actionable error after bounded authentication retries", async () => {
    const { api, fetchImpl, recover } = harness();
    fetchImpl.mockImplementation(async () => json({}, 401));
    await expect(api("/api/status")).rejects.toMatchObject({
      message: "Access expired",
      status: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(recover).toHaveBeenCalledOnce();
  });
  it.each([null, [], "invalid", 7])(
    "rejects invalid JSON envelopes: %j",
    async (value) => {
      const { api, fetchImpl } = harness();
      fetchImpl.mockResolvedValueOnce(json(value));
      await expect(api("/api/status")).rejects.toThrow(
        "invalid response envelope",
      );
    },
  );
  it("retains project recovery codes without trusting structured error text", async () => {
    const { api, fetchImpl } = harness();
    fetchImpl.mockResolvedValueOnce(
      json(
        { ok: false, error: { private: "data" }, errorCode: "unavailable" },
        409,
      ),
    );
    await expect(api("/api/project")).rejects.toMatchObject({
      message: "Request failed",
      projectErrorCode: "unavailable",
      status: 409,
    });
  });
  it("preserves the confirmed browser download blob", async () => {
    const { api, fetchImpl } = harness();
    fetchImpl.mockResolvedValueOnce(
      new Response("download", {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    const result = await api("/api/browser/download", { responseType: "blob" });
    expect(result).toBeInstanceOf(Blob);
    expect(await (result as Blob).text()).toBe("download");
  });
  it("downloads JSON website files without treating their contents as an API envelope", async () => {
    const { api, fetchImpl } = harness();
    fetchImpl.mockResolvedValueOnce(
      json({ ok: false, report: "website content" }),
    );
    const result = await api("/api/browser/download", { responseType: "blob" });
    expect(await (result as Blob).text()).toBe(
      JSON.stringify({ ok: false, report: "website content" }),
    );
  });
});
