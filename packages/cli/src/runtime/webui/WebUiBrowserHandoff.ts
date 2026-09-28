import type { WebUiImageAttachment, WebUiOptions } from "./WebUiContracts.js";
import type { WebUiBrowserPreviewBridge } from "./WebUiBrowserPreviewBridge.js";

interface BrowserPromptRequest {
  prompt: string;
  browserTabId?: string;
  browserTabUrl?: string;
}

/** Pin the browser page for one accepted WebUI prompt and release it on exit. */
export function bindBrowserPrompt(
  request: BrowserPromptRequest,
  attachments: WebUiImageAttachment[],
  submitPrompt: NonNullable<WebUiOptions["submitPrompt"]>,
  browserPreview: Pick<WebUiBrowserPreviewBridge, "pinTabForTurn">,
): () => Promise<{ ok: boolean; message?: string }> {
  const release = request.browserTabId
    ? browserPreview.pinTabForTurn(request.browserTabId, request.browserTabUrl)
    : undefined;
  return async () => {
    try {
      return await submitPrompt(
        request.prompt,
        attachments,
        release
          ? { browserAttached: true, onInitialRunComplete: release }
          : undefined,
      );
    } finally {
      release?.();
    }
  };
}
