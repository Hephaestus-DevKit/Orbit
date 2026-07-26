import type { McpPromptDescriptor } from "@orbit-build/core";

/** Slash-command token for one discovered MCP prompt. */
export function mcpPromptCommandName(
  serverName: string,
  promptName: string,
): string {
  return `mcp__${serverName}__${promptName}`;
}

interface DeclaredPromptArgument {
  name: string;
  required?: boolean;
}

/**
 * Map user-typed arguments onto a prompt's declared arguments. `key=value`
 * tokens bind to declared names; remaining free text fills the first unset
 * declared argument, so `/mcp__docs__search query=auth` and
 * `/mcp__docs__search auth tokens` both work.
 */
export function parseMcpPromptArguments(
  raw: string,
  declared: DeclaredPromptArgument[],
): Record<string, string> {
  const args: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed) return args;
  const tokens = trimmed.match(/(?:[^\s"]+"[^"]*"|"[^"]*"|[^\s"]+)+/g) ?? [];
  const positional: string[] = [];
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator > 0) {
      const key = token.slice(0, separator);
      if (declared.some((argument) => argument.name === key)) {
        args[key] = stripQuotes(token.slice(separator + 1));
        continue;
      }
    }
    positional.push(token);
  }
  if (positional.length) {
    const target = declared.find((argument) => !(argument.name in args));
    if (target) args[target.name] = stripQuotes(positional.join(" "));
  }
  return args;
}

/** Autocomplete candidates for every discovered MCP prompt. */
export function buildMcpPromptCommandCandidates(
  descriptors: McpPromptDescriptor[],
): Array<{
  command: `/${string}`;
  description: string;
  argumentHint?: string;
}> {
  return descriptors.map(({ serverName, prompt }) => {
    const argumentHint = (prompt.arguments ?? [])
      .map((argument) =>
        argument.required ? `<${argument.name}>` : `[${argument.name}]`,
      )
      .join(" ");
    return {
      command: `/${mcpPromptCommandName(serverName, prompt.name)}` as const,
      description: prompt.description || `MCP prompt from ${serverName}`,
      ...(argumentHint ? { argumentHint } : {}),
    };
  });
}

/** Resolve which discovered prompt a typed slash command refers to. */
export function findMcpPromptCommand(
  commandToken: string,
  descriptors: McpPromptDescriptor[],
): McpPromptDescriptor | undefined {
  return descriptors.find(
    (descriptor) =>
      mcpPromptCommandName(descriptor.serverName, descriptor.prompt.name) ===
      commandToken,
  );
}

function stripQuotes(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}
