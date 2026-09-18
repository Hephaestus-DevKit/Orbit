export interface BrowserEventScope {
  sessionId?: string;
  turnId?: string;
}

/** Pure, type-checked browser boundary shared by the assembled controller and its tests. */
export function shouldHandleOrbitEvent(
  value: unknown,
  active: BrowserEventScope,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (typeof event.type !== "string") return false;
  if (
    event.sessionId &&
    active.sessionId &&
    event.sessionId !== active.sessionId
  )
    return false;
  if (
    (event.type === "model_delta" || event.type === "thinking_delta") &&
    event.turnId &&
    active.turnId &&
    event.turnId !== active.turnId
  )
    return false;
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return false;
  const identity = payload as Record<string, unknown>;
  return !(
    identity.sessionId &&
    active.sessionId &&
    identity.sessionId !== active.sessionId
  );
}

export const WEB_UI_CLIENT_EVENT_ROUTING_SCRIPT = `  const shouldHandleOrbitEvent = (${shouldHandleOrbitEvent.toString()});\n\n`;
