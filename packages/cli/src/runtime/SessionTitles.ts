import type { AgentLoop } from "@orbit-build/core";
import { redactSecrets } from "@orbit-build/shared";

const DEFAULT_SESSION_TITLES = new Set(["", "New Orbit Session"]);
const MAX_TITLE_CHARACTERS = 64;
const MAX_LATIN_WORDS = 8;

/** Derive a short, stable task label without spending an additional model call. */
export function deriveSessionTitle(prompt: string): string {
  const firstMeaningfulLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstMeaningfulLine) return "Untitled task";

  const safe = redactSecrets(firstMeaningfulLine)
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+>]\s*/, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!safe) return "Untitled task";

  const clause = safe.split(/[。！？!?；;]|\s+[—–-]\s+/u, 1)[0]?.trim() || safe;
  const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    clause,
  );
  const compact = hasCjk
    ? Array.from(clause).slice(0, 30).join("")
    : clause.split(/\s+/).slice(0, MAX_LATIN_WORDS).join(" ");
  const bounded = Array.from(compact)
    .slice(0, MAX_TITLE_CHARACTERS)
    .join("")
    .replace(/[\s,.:;!?，。！？；：]+$/u, "")
    .trim();
  return bounded || "Untitled task";
}

/** Persist the first useful task title for the active Orbit session. */
export function ensureSessionTitle(
  loop: Pick<AgentLoop, "sessionManager">,
  prompt: string,
): string | undefined {
  try {
    const activeSession = loop.sessionManager?.getActiveSession();
    if (
      !activeSession
      || !DEFAULT_SESSION_TITLES.has(activeSession.title.trim())
    ) {
      return undefined;
    }
    const title = deriveSessionTitle(prompt);
    activeSession.title = title;
    loop.sessionManager.getSessionStore().updateSession(activeSession);
    return title;
  } catch {
    // Session labeling must never delay or block the actual agent turn.
    return undefined;
  }
}
