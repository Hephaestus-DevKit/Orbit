import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { CredentialsManager, DEFAULT_CONFIG } from "../packages/config/dist/index.js";
import { DeepSeekProvider } from "../packages/model-providers/dist/index.js";
import { WebSearchTool, WebFetchTool } from "../packages/tools/dist/index.js";

// Explicit opt-in; this script sends small, paid requests to the official API.
if (!process.argv.includes("--run")) {
  console.log(
    "Build first, then pass --run to verify official DeepSeek APIs with bounded paid requests.",
  );
  process.exit(0);
}
const key = process.env.DEEPSEEK_API_KEY
  || new CredentialsManager().getSecret("DEEPSEEK_API_KEY");
if (!key)
  throw new Error(
    "DeepSeek credential unavailable; configure CredentialsManager first.",
  );
const report = {
  checkedAt: new Date().toISOString(),
  results: [],
  requests: 0,
  uploads: 0,
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  report.requests++;
  if (new URL(String(url)).pathname === "/files") report.uploads++;
  return originalFetch(url, options);
};
const message = (role, content) => ({
  role,
  content,
  id: randomUUID(),
  createdAt: new Date().toISOString(),
});
const provider = (format, extra = {}) =>
  new DeepSeekProvider(key, "https://api.deepseek.com", {
    deepSeekApiFormat: format,
    disablePreheat: true,
    maxRetries: 0,
    requestTimeoutMs: 30_000,
    totalTimeoutMs: 60_000,
    ...extra,
  });
async function collect(client, input) {
  let text = "";
  let thinking = "";
  let signature;
  let usage;
  let done = false;
  const calls = [];
  const start = performance.now();
  let firstDeltaMs;
  for await (const event of client.chat({
    maxTokens: 2048,
    stream: true,
    retryBudget: 0,
    abortSignal: AbortSignal.timeout(60_000),
    ...input,
  })) {
    if (event.type === "error")
      throw new Error(
        "Provider request failed; inspect offline regression and API account status.",
      );
    if (event.type === "done") done = true;
    if (event.type === "usage") usage = event.usage;
    if (event.type === "text_delta" || event.type === "thinking_delta")
      firstDeltaMs ??= performance.now() - start;
    if (event.type === "text_delta") text += event.text;
    if (event.type === "thinking_delta") {
      thinking += event.text;
      if (event.signature) signature = event.signature;
    }
    if (event.type === "tool_call") calls.push(event.toolCall);
  }
  if (!done) throw new Error("Missing completion event.");
  return {
    text,
    thinking,
    signature,
    calls,
    usage,
    firstDeltaMs,
    totalMs: performance.now() - start,
  };
}
async function check(name, run) {
  try {
    const detail = await run();
    report.results.push({ name, passed: true, ...detail });
    console.log(`PASS ${name}`);
  } catch {
    report.results.push({ name, passed: false });
    console.log(`FAIL ${name}`);
  }
}

try {
  for (const format of ["chat-completions", "responses", "anthropic"]) {
    await check(`${format}: Pro non-thinking top_p`, async () => {
      const result = await collect(
        provider(format, { extraBody: { top_p: 0.3 } }),
        {
          model: "deepseek-v4-pro",
          thinking: { enabled: false },
          maxTokens: 128,
          messages: [
            message("user", [
              {
                type: "text",
                text: "Calculate 17 + 25. Return only the result.",
              },
            ]),
          ],
        },
      );
      if (result.text.trim() !== "42") throw new Error("Incorrect response.");
      return { totalMs: result.totalMs, usage: result.usage };
    });
    await check(
      `${format}: Flash reasoning and tool continuation`,
      async () => {
        const client = provider(format);
        const history = [
          message("user", [
            {
              type: "text",
              text:
                "Call read_nonce once, then return exactly the nonce from the tool. Do not guess it.",
            },
          ]),
        ];
        const tools = [
          {
            name: "read_nonce",
            description: "Read a test nonce",
            inputSchema: z.object({}),
          },
        ];
        const settings = {
          model: "deepseek-flash",
          thinking: { enabled: true, effort: "low" },
          tools,
        };
        const first = await collect(client, { ...settings, messages: history });
        if (first.calls.length !== 1 || first.calls[0].name !== "read_nonce")
          throw new Error("Unexpected tool call.");
        const nonce = randomUUID();
        history.push(
          message("assistant", [
            ...(first.thinking
              ? [
                {
                  type: "thinking",
                  text: first.thinking,
                  ...(first.signature ? { signature: first.signature } : {}),
                },
              ]
              : []),
            { type: "text", text: first.text },
            ...first.calls.map((toolCall) => ({ type: "tool_call", toolCall })),
          ]),
        );
        history.push(
          message("tool", [
            {
              type: "tool_result",
              toolResult: {
                toolCallId: first.calls[0].id,
                name: "read_nonce",
                content: nonce,
              },
            },
          ]),
        );
        const second = await collect(client, {
          ...settings,
          messages: history,
        });
        if (!second.text.includes(nonce))
          throw new Error("Tool continuation mismatch.");
        return {
          totalMs: first.totalMs + second.totalMs,
          usage: [first.usage, second.usage],
        };
      },
    );
  }

  // A synthetic red PNG fixture contains no user image or workspace data.
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";
  for (const format of ["chat-completions", "responses", "anthropic"]) {
    await check(`${format}: Flash image Files reuse`, async () => {
      const client = provider(format, { deepSeekFiles: true });
      const uploadsBefore = report.uploads;
      const request = {
        model: "deepseek-flash",
        thinking: { enabled: false },
        maxTokens: 128,
        messages: [
          message("user", [
            {
              type: "text",
              text: "Name the solid color in this image. Answer one English word.",
            },
            { type: "image", mediaType: "image/png", data: png },
          ]),
        ],
      };
      const first = await collect(client, request);
      if (!/red/i.test(first.text))
        throw new Error("Image recognition mismatch.");
      if (format === "anthropic") {
        const second = await collect(client, request);
        if (!/red/i.test(second.text))
          throw new Error("Reused image mismatch.");
      }
      if (report.uploads - uploadsBefore !== 1)
        throw new Error("Upload reuse mismatch.");
      return { totalMs: first.totalMs, usage: first.usage };
    });
  }
  const config = structuredClone(DEFAULT_CONFIG);
  config.tools.webSearch.provider = "deepseek";
  config.tools.webSearch.fetchProvider = "deepseek";
  config.tools.webSearch.timeoutMs = 30_000;
  const context = {
    cwd: process.cwd(),
    sessionId: "deepseek-live-smoke",
    config,
  };
  // Tools resolve the same credential themselves through CredentialsManager.
  await check("Search API", async () => {
    const result = await new WebSearchTool().execute(
      { query: "DeepSeek API documentation", maxResults: 2 },
      context,
    );
    if (!result.ok || !result.data?.includes("Link:"))
      throw new Error("Search did not return results.");
    return { usage: result.metadata?.externalUsage };
  });
  await check("Fetch API", async () => {
    const result = await new WebFetchTool().execute(
      { url: "https://api-docs.deepseek.com/", maxChars: 2000 },
      context,
    );
    if (!result.ok || !/deepseek/i.test(result.data ?? ""))
      throw new Error("Fetch did not return content.");
    return { usage: result.metadata?.externalUsage };
  });
} finally {
  globalThis.fetch = originalFetch;
  mkdirSync("output/local-deployment", { recursive: true });
  writeFileSync(
    "output/local-deployment/deepseek-live-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
}
if (report.results.some((result) => !result.passed)) process.exitCode = 1;
