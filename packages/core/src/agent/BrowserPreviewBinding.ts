import type {
  BrowserPreviewService,
  ToolRuntimeServices,
} from "@orbit-build/tools";

/** Bind a host preview by identity; an older host cannot detach its replacement. */
export function createBrowserPreviewBinding(services: ToolRuntimeServices) {
  return (
    service: BrowserPreviewService | undefined,
    expected?: BrowserPreviewService,
  ): void => {
    const previous = services.browserPreview;
    if (expected && previous !== expected) return;
    services.browserPreview = service;
    if (previous && previous !== service)
      void previous.reset().catch(() => undefined);
  };
}
