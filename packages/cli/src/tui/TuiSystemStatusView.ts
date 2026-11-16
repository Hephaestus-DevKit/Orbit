import { stripAnsiCodes, truncatePlainToWidth } from "./TerminalText.js";
import type { TuiTheme } from "./TuiTheme.js";
import type {
  TuiActionLink,
  TuiHistoryEntry,
} from "./TuiConversationViewModel.js";

function terminalHyperlink(label: string, url: string): string {
  return `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007`;
}

/** Format one system status without terminal state or I/O. */
export function formatSystemStatusLine(
  theme: TuiTheme,
  rawLine: string,
  prefixUnknown: boolean,
  actionLink?: TuiActionLink,
): string {
  const morandi = theme;
  const plain = stripAnsiCodes(rawLine.trim()).trim();
  if (!plain) return "";
  if (/^(?:✓|✔)\s*Success/i.test(plain) || /^✖\s*Failed/i.test(plain)) {
    return "";
  }
  if (plain.startsWith("✔")) {
    const renderedLink = actionLink
      ? ` ${terminalHyperlink(
          morandi.accent(actionLink.label),
          actionLink.url,
        )} ${morandi.dim("·")}`
      : "";
    return (
      morandi.completed("completed") +
      renderedLink +
      morandi.gray(plain.substring(1))
    );
  }
  if (plain.startsWith("✖")) {
    return morandi.failed("failed") + morandi.gray(plain.substring(1));
  }
  if (plain.startsWith("●")) {
    return morandi.cyan("●") + morandi.gray(plain.substring(1));
  }
  if (plain.startsWith("✦")) {
    return morandi.cyan("✦") + morandi.gray(plain.substring(1));
  }
  if (plain.startsWith("⚠")) {
    return morandi.warn("⚠") + morandi.gray(plain.substring(1));
  }
  if (prefixUnknown) {
    return morandi.cyan("✦") + " " + morandi.gray(plain);
  }
  return morandi.gray(plain);
}

/** Collapse bounded lookup progress into readable terminal status lines. */
export function formatSystemLinesForDisplay(
  theme: TuiTheme,
  system: TuiHistoryEntry[],
  options: { prefixUnknown: boolean; preserveBlank: boolean },
): string[] {
  const morandi = theme;
  const lines: string[] = [];
  let liveLookupCount = 0;
  let liveLookupTool = "";
  let liveLookupResults = 0;
  let liveLookupOpenMeteo = false;
  let lastLiveLookupQuery = "";

  const flushLiveLookupSummary = () => {
    if (liveLookupCount === 0) return;
    const resultsText =
      liveLookupResults > 0 ? ` · ${liveLookupResults} results` : "";
    const sourceText = liveLookupOpenMeteo ? " · Open-Meteo" : "";
    const queryText = lastLiveLookupQuery
      ? truncatePlainToWidth(lastLiveLookupQuery, 42)
      : "";
    const label =
      liveLookupTool && liveLookupTool !== "mixed"
        ? liveLookupTool
        : "live_lookup";
    const summary =
      liveLookupCount === 1
        ? `${label}${queryText ? ` ${queryText}` : ""}${resultsText}${sourceText}`
        : label === "web_search"
          ? `web_search ${liveLookupCount} searches${resultsText}${
              queryText ? ` · latest: ${queryText}` : ""
            }`
          : `${label} ${liveLookupCount} lookups${resultsText}${sourceText}${
              queryText ? ` · latest: ${queryText}` : ""
            }`;
    lines.push(morandi.cyan("✦") + " " + morandi.gray(summary));
    liveLookupCount = 0;
    liveLookupTool = "";
    liveLookupResults = 0;
    liveLookupOpenMeteo = false;
    lastLiveLookupQuery = "";
  };

  for (const sys of system) {
    let pendingActionLink = sys.actionLink;
    const rawLines = sys.text.split("\n");
    for (const rawLine of rawLines) {
      const plain = stripAnsiCodes(rawLine.trim()).trim();
      if (!plain) {
        flushLiveLookupSummary();
        if (options.preserveBlank) lines.push("");
        continue;
      }

      const liveLookupMatch = plain.match(
        /^✦\s*(?:✨\s*)?(web_search)\b\s*(.*)$/i,
      );
      if (liveLookupMatch) {
        liveLookupCount += 1;
        const toolName = liveLookupMatch[1] || "";
        liveLookupTool =
          !liveLookupTool || liveLookupTool === toolName ? toolName : "mixed";
        const query = liveLookupMatch[2]?.trim();
        if (query) lastLiveLookupQuery = query;
        continue;
      }

      const webSearchSuccess = plain.match(
        /^(?:✓|✔)\s*Success:\s*Web search returned\s+(\d+)\s+results?/i,
      );
      if (webSearchSuccess) {
        liveLookupResults += Number(webSearchSuccess[1] || 0);
        continue;
      }

      if (
        /^(?:✓|✔)\s*Success:\s*Weather data returned\b.*\bOpen-Meteo\b/i.test(
          plain,
        )
      ) {
        liveLookupOpenMeteo = true;
        continue;
      }

      if (/^⚠.*(?:DeepSeek|Prompt) cache hit degraded/i.test(plain)) {
        continue;
      }

      flushLiveLookupSummary();
      const formatted = formatSystemStatusLine(
        theme,
        rawLine,
        options.prefixUnknown,
        pendingActionLink,
      );
      if (formatted) {
        lines.push(formatted);
        pendingActionLink = undefined;
      }
    }
  }
  flushLiveLookupSummary();
  return lines;
}
