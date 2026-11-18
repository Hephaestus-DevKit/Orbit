const SENSITIVE_KEY_PATTERN =
  /(?:api[-_]?key|authorization|credential|password|secret|cookie|(?:^|[-_.])token(?:$|[-_.])|(?:access|refresh|bearer|auth)Token)/i;
const AUTH_HEADER_PATTERN = /(?:^|[-_.])auth(?:$|[-_.])/i;

/** Produces a serializable configuration view with credential-like values removed. */
export function redactConfigForDisplay(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) || AUTH_HEADER_PATTERN.test(key)
      ? item === undefined
        ? undefined
        : "[REDACTED]"
      : redactValue(item, seen);
  }
  return output;
}
