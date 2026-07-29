import { redactSecrets } from "@orbit-build/shared";

export const PROCESS_OUTPUT_MAX_BYTES = 8 * 1024 * 1024;

export function safeProcessFailureMessage(message: string): string {
  return redactSecrets(message)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2_000);
}

export function readProcessFailureMessage(result: unknown): string {
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
  return safeProcessFailureMessage(message);
}
