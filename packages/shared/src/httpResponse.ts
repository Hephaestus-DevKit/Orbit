/** Read an HTTP response without allowing an untrusted peer to exhaust memory. */
export async function readResponseTextWithinLimit(
  response: Response,
  maxBytes: number,
  label = "HTTP response",
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("HTTP response byte limit must be a positive integer.");
  }
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength >= 0 &&
    declaredLength > maxBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} exceeded the ${maxBytes}-byte limit.`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    if (typeof response.text !== "function") return "";
    const fallback = await response.text();
    if (new TextEncoder().encode(fallback).byteLength > maxBytes) {
      throw new Error(`${label} exceeded the ${maxBytes}-byte limit.`);
    }
    return fallback;
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let completed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        break;
      }
      if (next.value.byteLength > maxBytes - totalBytes) {
        throw new Error(`${label} exceeded the ${maxBytes}-byte limit.`);
      }
      chunks.push(next.value);
      totalBytes += next.value.byteLength;
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

/** Parse a size-bounded JSON response. Schema validation remains the caller's job. */
export async function readResponseJsonWithinLimit(
  response: Response,
  maxBytes: number,
  label = "HTTP JSON response",
): Promise<unknown> {
  if (!response.body && typeof response.json === "function") {
    const value = (await response.json()) as unknown;
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
      throw new Error(`${label} exceeded the ${maxBytes}-byte limit.`);
    }
    return value;
  }
  return JSON.parse(
    await readResponseTextWithinLimit(response, maxBytes, label),
  ) as unknown;
}
