import { describe, expect, it, vi } from "vitest";
import { discoverProviderModels } from "./ModelDiscovery.js";

describe("discoverProviderModels", () => {
  it("uses only the exact API base and preserves declared capabilities", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        data: [
          { id: "deepseek-flash", context_length: 1_048_576 },
          {
            id: "vision-coder",
            context_length: 256_000,
            max_output_tokens: 32_000,
            architecture: { input_modalities: ["text", "image"] },
            capabilities: { reasoning: true },
            supported_parameters: ["tools", "response_format"],
          },
          { id: "embed-large", type: "embedding" },
          {
            id: "video-generator",
            architecture: { output_modalities: ["video"] },
          },
        ],
      }),
    );

    const result = await discoverProviderModels({
      baseUrl: "https://tokendance.space/gateway/v1",
      apiKey: "private-key",
      fetchImpl,
    });

    expect(result.baseUrl).toBe("https://tokendance.space/gateway/v1");
    expect(result.models).toEqual([
      "deepseek-flash",
      "vision-coder",
      "embed-large",
      "video-generator",
    ]);
    expect(result.modelCapabilities["vision-coder"]).toEqual({
      maxContextTokens: 256_000,
      maxOutputTokens: 32_000,
      vision: true,
      thinking: true,
      toolCalls: true,
      jsonMode: true,
      inputModalities: ["text", "image"],
      kind: "chat",
    });
    expect(result.modelCapabilities["embed-large"]?.kind).toBe("embedding");
    expect(result.modelCapabilities["video-generator"]?.kind).toBe("video");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      new URL("https://tokendance.space/gateway/v1/models"),
      expect.objectContaining({
        redirect: "error",
        headers: expect.any(Headers),
      }),
    );
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("Authorization")).toBe(
      "Bearer private-key",
    );
  });

  it("never guesses versioned or vendor-specific suffixes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(
      discoverProviderModels({
        baseUrl: "https://gateway.example/v1",
        fetchImpl,
      }),
    ).rejects.toThrow("/v1/models");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://gateway.example/v1/models"),
      expect.anything(),
    );
  });

  it("accepts models arrays and rejects insecure remote endpoints", async () => {
    const result = await discoverProviderModels({
      baseUrl: "http://127.0.0.1:11434/v1",
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ models: [{ model: "qwen-coder" }] }),
        ),
    });
    expect(result.models).toEqual(["qwen-coder"]);

    await expect(
      discoverProviderModels({ baseUrl: "http://example.com/v1" }),
    ).rejects.toThrow("requires HTTPS");
  });

  it("scans Ollama's native installed-model catalog", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          models: [
            {
              name: "ignored-alias",
              model: "qwen2.5-coder:7b",
              details: { context_length: 32_768 },
            },
            { model: "nomic-embed-text:latest" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ capabilities: ["completion", "tools"] }),
      )
      .mockResolvedValueOnce(Response.json({ capabilities: ["embedding"] }));

    const result = await discoverProviderModels({
      baseUrl: "http://localhost:11434",
      providerType: "ollama",
      fetchImpl,
    });

    expect(result.modelsEndpoint).toBe("http://localhost:11434/api/tags");
    expect(result.models).toEqual([
      "qwen2.5-coder:7b",
      "nomic-embed-text:latest",
    ]);
    expect(result.modelCapabilities["qwen2.5-coder:7b"]).toMatchObject({
      kind: "chat",
      toolCalls: true,
      maxContextTokens: 32_768,
    });
    expect(result.modelCapabilities["nomic-embed-text:latest"]?.kind).toBe(
      "embedding",
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://localhost:11434/api/tags"),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).has("Authorization")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("http://localhost:11434/api/show"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not expose response bodies when discovery fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('secret-token: "should-not-leak"', { status: 500 }),
      );
    await expect(
      discoverProviderModels({
        baseUrl: "https://example.com/v1",
        fetchImpl,
      }),
    ).rejects.not.toThrow("should-not-leak");
  });
});
