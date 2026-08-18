import { redactSecrets } from "@orbit-build/shared";

export const PROCESS_OUTPUT_MAX_BYTES = 8 * 1024 * 1024;

export interface ProcessFailureContext {
  sandboxBackend?: string;
}

export function safeProcessFailureMessage(message: string): string {
  return redactSecrets(message)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2_000);
}

export function readProcessFailureMessage(
  result: unknown,
  context: ProcessFailureContext = {},
): string {
  const message = rawProcessFailureMessage(result);
  if (
    context.sandboxBackend === "macos-sandbox-exec" &&
    message.includes("sandbox-exec -p")
  ) {
    const signal = message.match(/\bSIG[A-Z0-9]+\b/)?.[0];
    return signal
      ? `The macOS sandboxed process was terminated by ${signal}.`
      : "The macOS sandboxed process failed before command completion.";
  }
  return safeProcessFailureMessage(message);
}

export function processOutputLimitExceeded(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const record = result as Record<string, unknown>;
  return (
    record.isMaxBuffer === true ||
    /maxBuffer exceeded/i.test(rawProcessFailureMessage(result))
  );
}

function rawProcessFailureMessage(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    return "The child process failed.";
  }
  const record = result as Record<string, unknown>;
  const message =
    typeof record.shortMessage === "string"
      ? record.shortMessage
      : typeof record.message === "string"
        ? record.message
        : "The child process failed.";
  return message;
}
