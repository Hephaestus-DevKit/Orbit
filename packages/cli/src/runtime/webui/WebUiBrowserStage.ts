export type BrowserStageMode =
  | "hidden"
  | "idle"
  | "opening"
  | "closing"
  | "waiting"
  | "disconnected"
  | "error";

/** Select the browser canvas fallback without hiding a usable last frame. */
export function browserStageMode(input: {
  active: boolean;
  loading: boolean;
  pending: boolean;
  closing: boolean;
  hasImage: boolean;
  disconnected: boolean;
  failed: boolean;
  idleNotice: boolean;
}): BrowserStageMode {
  if (input.closing) return "closing";
  if (input.disconnected && !input.hasImage) return "disconnected";
  if (input.pending || input.loading) return "opening";
  if (input.hasImage || input.idleNotice) return "hidden";
  if (input.disconnected) return "disconnected";
  if (input.failed) return "error";
  return input.active ? "waiting" : "idle";
}
