import { redactSecrets } from "./redaction.js";

export interface ExternalErrorMessageOptions {
  /** Maximum UTF-16 code units returned to the caller. */
  maxLength?: number;
  /** Collapse line breaks and control-character runs to a single space. */
  singleLine?: boolean;
}

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]+/g;

/**
 * Convert an untrusted external failure into bounded, credential-safe text.
 * ANSI escapes and non-printing controls are removed before the size bound is
 * applied so callers cannot smuggle terminal behavior or secrets into logs.
 */
export function sanitizeExternalErrorMessage(
  value: unknown,
  options: ExternalErrorMessageOptions = {},
): string {
  const maxLength = options.maxLength ?? 2_000;
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) {
    throw new RangeError(
      "External error maxLength must be a positive integer.",
    );
  }
  const source = value instanceof Error ? value.message : String(value);
  const withoutTerminalControls = source
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(CONTROL_CHARACTER_PATTERN, " ");
  const normalized = options.singleLine
    ? withoutTerminalControls.replace(/[\r\n]+/g, " ")
    : withoutTerminalControls;
  return redactSecrets(normalized).trim().slice(0, maxLength);
}
