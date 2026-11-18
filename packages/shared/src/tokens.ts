export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  let asciiCharacters = 0;
  let nonAsciiCharacters = 0;
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) {
      asciiCharacters++;
    } else {
      nonAsciiCharacters++;
    }
  }

  // Code and JSON average roughly 3.2 ASCII characters per token. CJK and
  // other non-ASCII scripts are commonly much denser, so count each Unicode
  // code point as one token. The deliberately conservative estimate makes the
  // context guard compact before a provider rejects the request.
  return Math.ceil(asciiCharacters / 3.2 + nonAsciiCharacters);
}

/** Retains the beginning and end of text within a conservative token budget. */
export function truncateTextToTokenBudget(
  text: string,
  maxTokens: number,
  marker = "\n\n... [truncated to fit token budget] ...\n\n",
): string {
  const normalizedBudget = Math.max(1, Math.floor(maxTokens));
  if (estimateTokenCount(text) <= normalizedBudget) return text;
  if (estimateTokenCount(marker) >= normalizedBudget) {
    return marker.slice(0, normalizedBudget);
  }

  let low = 0;
  let high = text.length;
  let best = marker;
  while (low <= high) {
    const retainedCharacters = Math.floor((low + high) / 2);
    const headCharacters = Math.floor(retainedCharacters * 0.8);
    const tailCharacters = retainedCharacters - headCharacters;
    const candidate = text.slice(0, headCharacters)
      + marker
      + (tailCharacters > 0 ? text.slice(-tailCharacters) : "");
    if (estimateTokenCount(candidate) <= normalizedBudget) {
      best = candidate;
      low = retainedCharacters + 1;
    } else {
      high = retainedCharacters - 1;
    }
  }
  return best;
}
