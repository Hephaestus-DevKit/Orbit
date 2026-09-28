import { describe, expect, it, vi } from "vitest";
import type { ToolRuntimeServices } from "@orbit-build/tools";
import { createBrowserPreviewBinding } from "./BrowserPreviewBinding.js";

describe("browser preview host binding", () => {
  it("closes old ownership without letting an old host detach its replacement", async () => {
    const services: ToolRuntimeServices = {};
    const bind = createBrowserPreviewBinding(services);
    const first = {
      execute: vi.fn(),
      reset: vi.fn().mockResolvedValue(undefined),
    };
    const second = {
      execute: vi.fn(),
      reset: vi.fn().mockResolvedValue(undefined),
    };
    bind(first);
    bind(first);
    expect(first.reset).not.toHaveBeenCalled();
    bind(second);
    expect(first.reset).toHaveBeenCalledOnce();
    bind(undefined, first);
    expect(services.browserPreview).toBe(second);
    bind(undefined, second);
    expect(second.reset).toHaveBeenCalledOnce();
    expect(services.browserPreview).toBeUndefined();
  });
});
