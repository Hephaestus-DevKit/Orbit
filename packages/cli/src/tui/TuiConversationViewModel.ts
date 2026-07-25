export interface TuiActionLink {
  label: string;
  url: string;
}

export interface TuiHistoryEntry {
  role: "user" | "assistant" | "system";
  text: string;
  actionLink?: TuiActionLink;
  thoughtTime?: number;
  totalTime?: number;
  attempt?: number;
  model?: string;
}

export interface TuiConversationTurn {
  user?: TuiHistoryEntry;
  assistant?: TuiHistoryEntry;
  system: TuiHistoryEntry[];
}

export interface TuiConversationViewModel {
  turns: TuiConversationTurn[];
  lastAssistant?: TuiHistoryEntry;
}

/** Convert the append-only message stream into deterministic render turns. */
export function buildTuiConversationViewModel(
  history: readonly TuiHistoryEntry[],
): TuiConversationViewModel {
  const turns: TuiConversationTurn[] = [];
  let currentTurn: TuiConversationTurn | undefined;
  let lastAssistant: TuiHistoryEntry | undefined;

  for (const message of history) {
    if (message.role === "user") {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = { user: message, system: [] };
      continue;
    }
    currentTurn ??= { system: [] };
    if (message.role === "assistant") {
      currentTurn.assistant = message;
      lastAssistant = message;
    } else {
      currentTurn.system.push(message);
    }
  }
  if (currentTurn) turns.push(currentTurn);
  return { turns, lastAssistant };
}
