import { OrbitMessage } from "@orbit-build/model-providers";

export class Compactor {
  public compact(messages: OrbitMessage[]): string {
    const steps: string[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        const text = msg.content
          .flatMap((content) => (content.type === "text" ? [content.text] : []))
          .join(" ");
        if (text) steps.push(`User Goal: ${text}`);
      } else if (msg.role === "assistant") {
        const text = msg.content
          .flatMap((content) => (content.type === "text" ? [content.text] : []))
          .join(" ");
        const tools = msg.content
          .flatMap((content) =>
            content.type === "tool_call"
              ? [`Called ${content.toolCall.name}`]
              : []
          )
          .join(", ");

        if (tools) steps.push(`Action: ${tools}`);
        if (text) steps.push(`Orchestrator plan: ${text}`);
      } else if (msg.role === "tool") {
        const results = msg.content
          .flatMap((content) => {
            if (content.type !== "tool_result") return [];
            const tr = content.toolResult;
            return [
              `Result of ${tr.name}: ${tr.isError ? "Failed" : "Success"} (${
                tr.content.substring(0, 100)
              }...)`,
            ];
          })
          .join("\n");
        if (results) steps.push(results);
      }
    }

    return `### COMPACTED CONTEXT SUMMARY\n\n${steps.join("\n\n")}`;
  }
}
