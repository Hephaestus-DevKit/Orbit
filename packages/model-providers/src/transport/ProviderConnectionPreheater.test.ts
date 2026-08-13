import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderConnectionPreheater } from "./ProviderConnectionPreheater.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ProviderConnectionPreheater", () => {
  it("does no network I/O until explicitly initialized and coalesces repeats", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({ body: { cancel } }) as never;
    const preheater = new ProviderConnectionPreheater(
      "https://provider.example.com",
    );

    expect(global.fetch).not.toHaveBeenCalled();
    await Promise.all([preheater.initialize(), preheater.initialize()]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://provider.example.com",
      expect.objectContaining({ method: "HEAD" }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("skips disabled preheating and contains transport failures", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as never;
    await expect(
      new ProviderConnectionPreheater(
        "https://provider.example.com",
        true,
      ).initialize(),
    ).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();

    await expect(
      new ProviderConnectionPreheater(
        "https://provider.example.com",
      ).initialize(),
    ).resolves.toBeUndefined();
  });
});
