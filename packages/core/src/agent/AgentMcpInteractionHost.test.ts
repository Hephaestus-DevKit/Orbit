import { describe, expect, it, mockTools as vi } from "../../../../scripts/testing/support.mjs";
import type { ModelProvider } from "@orbit-build/model-providers";
import type { UserInteraction } from "./AgentInteraction.js";
import { AgentMcpInteractionHost } from "./AgentMcpInteractionHost.js";

function harness() {
  const askApproval = vi.fn(async () => true);
  const interaction: UserInteraction = {
    askApproval,
    showText: () => {},
    showDiff: () => {},
    prompt: {
      askText: vi.fn(async () => "yes"),
      askSelect: vi.fn(async () => "yes"),
      askMultiSelect: vi.fn(async () => []),
    },
  };
  const chat = vi.fn<ModelProvider["chat"]>(async function* () {
    yield { type: "text_delta", text: "nested reply" };
  });
  const provider: ModelProvider = {
    id: "fixture",
    type: "openai-compatible",
    capabilities: {
      streaming: true,
      toolCalls: false,
      jsonMode: false,
      thinking: false,
      vision: false,
      promptCaching: false,
    },
    chat,
  };
  let model = "first";
  const host = new AgentMcpInteractionHost({
    cwd: process.cwd(),
    getInteraction: () => interaction,
    getProvider: () => provider,
    getModel: () => model,
  });
  return {
    handlers: host.createHandlers(),
    interaction,
    askApproval,
    chat,
    selectModel: (value: string) => {
      model = value;
    },
  };
}
describe("Agent MCP interaction host", () => {
  it("never prompts for server-requested credentials", async () => {
    const { handlers, interaction, askApproval } = harness();
    await expect(
      handlers.onElicitation!(
        {
          method: "elicitation/create",
          params: {
            requestedSchema: { properties: { apiKey: { type: "string" } } },
          },
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ action: "decline" });
    expect(interaction.prompt!.askText).not.toHaveBeenCalled();
    expect(askApproval).not.toHaveBeenCalled();
  });
  it("requires approval and uses the current model for nested sampling", async () => {
    const { handlers, chat, askApproval, selectModel } = harness();
    selectModel("second");
    await expect(
      handlers.onSampling!(
        {
          method: "sampling/createMessage",
          params: {
            messages: [
              { role: "user", content: { type: "text", text: "hello" } },
            ],
          },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      model: "second",
      content: { text: "nested reply" },
    });
    expect(askApproval).toHaveBeenCalledOnce();
    expect(chat.mock.calls[0]![0].model).toBe("second");
    askApproval.mockResolvedValueOnce(false);
    await expect(
      handlers.onSampling!(
        {
          method: "sampling/createMessage",
          params: {
            messages: [
              { role: "user", content: { type: "text", text: "hello" } },
            ],
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("denied");
    expect(chat).toHaveBeenCalledOnce();
  });
  it("cancels while approval is pending and never launches the provider", async () => {
    const { handlers, askApproval, chat } = harness();
    askApproval.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    const controller = new AbortController();
    const pending = handlers.onSampling!(
      {
        method: "sampling/createMessage",
        params: {
          messages: [
            { role: "user", content: { type: "text", text: "hello" } },
          ],
        },
      },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(chat).not.toHaveBeenCalled();
  });
  it("rejects unsafe URL interactions before asking the user", async () => {
    const { handlers, askApproval } = harness();
    await expect(
      handlers.onElicitation!(
        {
          method: "elicitation/create",
          params: { mode: "url", url: "file:///private/file" },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("HTTP(S)");
    expect(askApproval).not.toHaveBeenCalled();
  });
});
