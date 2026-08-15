import { redactSecrets } from "@orbit-build/shared";
import type { ToolResult } from "@orbit-build/tools";

const NETWORK_RESULT_LIMIT = 10;
const NETWORK_SUMMARY_CHARS = 280;
const NETWORK_RESULT_CHARS = 6_000;
export const TOOL_RESULT_MAX_CHARS = 24_000;
export const TOOL_STATUS_MAX_CHARS = 2_000;
export const TOOL_ERROR_MAX_CHARS = 8_000;

interface SearchResultBlock {
  index: string;
  title: string;
  link: string;
  summary: string;
}

/** Bounds model-visible tool output and compacts structured web search data. */
export function buildToolResultContent(
  toolName: string,
  result: ToolResult<unknown>,
): string {
  const content = result.ok
    ? serializeToolResultData(result.data, result.display)
    : serializeToolFailure(result.error, result.display);
  const redacted = redactSecrets(content);

  if (!result.ok || toolName !== "web_search") {
    return truncateToolText(
      redacted,
      result.ok ? TOOL_RESULT_MAX_CHARS : TOOL_ERROR_MAX_CHARS,
    );
  }

  return compactSearchResult(redacted, redactSecrets(result.display || ""));
}

function serializeToolFailure(error?: string, display?: string): string {
  const message = error?.trim() || "Unknown error";
  const output = display?.trim();
  if (!output || output === message) return message;
  return `${message}\n\nCaptured command output:\n${output}`;
}

/** Truncates model-visible status without splitting the context budget. */
export function truncateToolText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const suffix = "\n... [truncated for context budget]";
  return `${text.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

function serializeToolResultData(data: unknown, display?: string): string {
  if (typeof data === "string") return data;
  if (data === undefined) return display?.trim() || "Done";
  try {
    return JSON.stringify(data) ?? String(data);
  } catch {
    return String(data);
  }
}

function compactSearchResult(content: string, display: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const header = display
    ? `web_search result: ${display}`
    : "web_search result";
  if (!normalized) return header;
  if (normalized.startsWith("Source: Open-Meteo weather API")) {
    return truncateToolText(`${header}\n${normalized}`, NETWORK_RESULT_CHARS);
  }

  const parsedResults = parseSearchResultBlocks(normalized);
  if (parsedResults.length === 0) {
    return truncateToolText(`${header}\n${normalized}`, NETWORK_RESULT_CHARS);
  }

  const keep = parsedResults.slice(0, NETWORK_RESULT_LIMIT);
  const lines = [
    header,
    `Results kept for reasoning: ${keep.length}/${parsedResults.length}. Use another live lookup only if these results are insufficient or stale.`,
  ];
  for (const result of keep) {
    lines.push(
      `[${result.index}] ${result.title}`,
      `Link: ${result.link}`,
      `Summary: ${truncateToolText(result.summary, NETWORK_SUMMARY_CHARS)}`,
    );
  }
  return truncateToolText(lines.join("\n"), NETWORK_RESULT_CHARS);
}

function parseSearchResultBlocks(content: string): SearchResultBlock[] {
  const results: SearchResultBlock[] = [];
  const regex =
    /\[(\d+)\]\s+Title:\s*([\s\S]*?)\n\s*Link:\s*([^\n]+)\n\s*Summary:\s*([\s\S]*?)(?=\n\n\[\d+\]\s+Title:|\s*$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    results.push({
      index: match[1],
      title: truncateToolText(match[2], 180),
      link: match[3].trim(),
      summary: match[4].replace(/\s+/g, " ").trim(),
    });
  }
  return results;
}
