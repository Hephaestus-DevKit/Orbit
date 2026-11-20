/** Validate a WebUI turn before acquiring a run or consuming attachments. */
export function resolveWebUiPromptMode(
  executionMode: "default" | "single" | "multi",
  defaultMulti: boolean,
  worktreeIsolation: boolean,
  imageCount: number,
  prompt: string,
): { useMulti: boolean; error?: string } {
  const useMulti = executionMode === "multi"
    || (executionMode === "default" && defaultMulti)
    || worktreeIsolation;
  if (!prompt) return { useMulti, error: "Prompt is empty." };
  if (useMulti && imageCount > 0)
    return {
      useMulti,
      error: "Image attachments are not yet supported in multi-agent mode.",
    };
  return { useMulti };
}
