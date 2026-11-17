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

export interface WebUiStreamEvent extends BrowserEventScope {
  kind:
    | "system"
    | "heartbeat"
    | "replay_gap"
    | "turn_started"
    | "turn_done"
    | "orbit_event";
  type?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Validate frames before they reach mutable browser state; invalid input is ignored. */
export function parseWebUiStreamEvent(raw: unknown): WebUiStreamEvent | null {
  if (typeof raw !== "string" || raw.length > 8 * 1024 * 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.kind !== "string" ||
    ![
      "system",
      "heartbeat",
      "replay_gap",
      "turn_started",
      "turn_done",
      "orbit_event",
    ].includes(event.kind)
  )
    return null;
  for (const key of ["sessionId", "turnId"]) {
    if (
      event[key] !== undefined &&
      (typeof event[key] !== "string" || (event[key] as string).length > 256)
    )
      return null;
  }
  if (
    event.kind === "turn_started" &&
    (typeof event.turnId !== "string" || !event.turnId)
  )
    return null;
  if (
    event.kind === "turn_done" &&
    (typeof event.turnId !== "string" ||
      !event.turnId ||
      typeof event.status !== "string" ||
      !["completed", "failed", "aborted"].includes(event.status))
  )
    return null;
  if (event.kind === "orbit_event") {
    if (
      typeof event.type !== "string" ||
      !event.type ||
      event.type.length > 128 ||
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    )
      return null;
    const payload = event.payload as Record<string, unknown>;
    if (
      (event.type === "model_delta" || event.type === "thinking_delta") &&
      typeof payload.text !== "string"
    )
      return null;
    if (
      payload.sessionId !== undefined &&
      typeof payload.sessionId !== "string"
    )
      return null;
  }
  return event as WebUiStreamEvent;
}

export const WEB_UI_CLIENT_STREAM_PARSER_SCRIPT = `  const parseWebUiStreamEvent = (${parseWebUiStreamEvent.toString()});\n\n`;
