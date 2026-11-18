import { redactSecrets } from "@orbit-build/shared";
import { JsonValue, JsonValueSchema } from "./types.js";

const CREDENTIAL_ASSIGNMENT_PATTERN =
  /(\b(?:api[-_]?key|authorization|credentials?|password|passwd|secret|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer[-_]?token|session[-_]?token|client[-_]?secret|private[-_]?key|cookie)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]*)/gi;

const SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:api_key|authorization|credentials?|password|passwd|secret|access_token|refresh_token|auth_token|bearer_token|session_token|client_secret|private_key|cookie)(?:$|_)/;

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z\d]+/g, "_")
    .toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    SENSITIVE_KEY_PATTERN.test(normalized)
    || normalized === "token"
    || normalized.endsWith("_token")
  );
}

/** Redacts credential-shaped values while preserving ordinary audit text. */
export function redactAuditText(text: string): string {
  return redactSecrets(text)
    .replace(CREDENTIAL_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
}

function sanitizeString(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return JSON.stringify(sanitizeAuditValue(parsed));
    } catch {
      // Fall through and redact the original string without changing its shape.
    }
  }
  return redactAuditText(value);
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null) return null;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : `[Non-finite number: ${value}]`;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "[Undefined]";
  if (typeof value === "function") return "[Function]";
  if (typeof value === "symbol") return "[Symbol]";

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? "[Invalid Date]"
      : value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: redactAuditText(value.name),
      message: redactAuditText(value.message),
    };
  }

  const output: Record<string, JsonValue> = {};
  try {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      output[key] = isSensitiveKey(key)
        ? "[REDACTED]"
        : sanitizeValue(item, seen);
    }
  } catch {
    return "[Unserializable object]";
  }
  return output;
}

/** Converts an unknown audit payload into a JSON-safe, credential-redacted value. */
export function sanitizeAuditValue(value: unknown): JsonValue {
  return JsonValueSchema.parse(sanitizeValue(value, new WeakSet<object>()));
}

/** Serializes an unknown tool input or output without leaking credentials. */
export function serializeAuditValue(value: unknown): string {
  return redactSecrets(JSON.stringify(sanitizeAuditValue(value)));
}

/** Redacts both structured and free-form credential data in stored JSON text. */
export function redactAuditJson(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    return serializeAuditValue(parsed);
  } catch {
    return redactAuditText(text);
  }
}
