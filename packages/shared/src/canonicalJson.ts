export type CanonicalJsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

/**
 * Convert JSON-compatible input into a recursively key-sorted value.
 *
 * The omission/null rules intentionally match `JSON.stringify`: unsupported
 * object properties are omitted while unsupported array entries become null.
 * Cyclic values and non-finite numbers are rejected instead of producing an
 * unstable provider request.
 */
export function canonicalizeJson(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Canonical JSON does not support non-finite numbers.",
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(
      `Canonical JSON does not support ${typeof value} values.`,
    );
  }
  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON does not support cyclic values.");
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.map((item) =>
      canonicalizeArrayValueWithAncestors(item, nextAncestors),
    );
  }

  const result: Record<string, CanonicalJsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (
      item === undefined ||
      typeof item === "function" ||
      typeof item === "symbol"
    ) {
      continue;
    }
    result[key] = canonicalizeJson(item, nextAncestors);
  }
  return result;
}

function canonicalizeArrayValueWithAncestors(
  value: unknown,
  ancestors: ReadonlySet<object>,
): CanonicalJsonValue {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return null;
  }
  return canonicalizeJson(value, ancestors);
}

/** Serialize JSON-compatible input with deterministic object-key ordering. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}
