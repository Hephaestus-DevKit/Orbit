import { describe, expect, it } from "vitest";
import type { ModelCapabilities } from "@orbit-build/model-providers";
import { validateImageAttachments } from "./CommandRouter.js";

const attachment = (size: number, name = "图像.png") => ({
  id: "att_demo",
  name,
  mediaType: "image/png" as const,
  data: "AA==",
  size,
});

const baseCapabilities = (
  overrides: Partial<ModelCapabilities> = {},
): ModelCapabilities => ({
  streaming: false,
  toolCalls: false,
  jsonMode: false,
  thinking: false,
  vision: false,
  promptCaching: false,
  ...overrides,
});

describe("model-specific image limits", () => {
  it("rejects images for non-vision models", () => {
    expect(
      validateImageAttachments("text-model", baseCapabilities(), [
        attachment(10),
      ]),
    ).toMatch(/does not support image input/);
  });

  it("enforces configured count and byte ceilings", () => {
    const capabilities = baseCapabilities({
      vision: true,
      maxImages: 1,
      maxImageBytes: 1024 * 1024,
    });
    expect(
      validateImageAttachments("vision-model", capabilities, [
        attachment(10),
        attachment(10, "第二张.png"),
      ]),
    ).toMatch(/at most 1/);
    expect(
      validateImageAttachments("vision-model", capabilities, [
        attachment(1024 * 1024 + 1),
      ]),
    ).toMatch(/exceeds the 1 MiB limit/);
  });

  it("accepts an attachment within model limits", () => {
    expect(
      validateImageAttachments(
        "vision-model",
        baseCapabilities({ vision: true, maxImages: 2, maxImageBytes: 1024 }),
        [attachment(512)],
      ),
    ).toBeUndefined();
  });
});
