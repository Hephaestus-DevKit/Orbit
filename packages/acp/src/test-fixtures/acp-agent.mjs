import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const mode = process.argv[2] || "normal";
const sessions = new Set();

const app = acp
  .agent({ name: "orbit-acp-test-agent" })
  .onRequest(acp.methods.agent.initialize, ({ params }) => ({
    protocolVersion: params.protocolVersion,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      sessionCapabilities: { resume: {}, close: {}, list: {} },
    },
    agentInfo: {
      name: "fixture-agent",
      title: "Fixture Agent",
      version: "1.0.0",
    },
    authMethods: [],
  }))
  .onRequest(acp.methods.agent.session.new, () => {
    const sessionId = `fixture-${Date.now()}`;
    sessions.add(sessionId);
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
    sessions.add(params.sessionId);
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "fixture-user-message",
        content: { type: "text", text: "fixture replayed question" },
      },
    });
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "fixture-agent-message",
        content: { type: "text", text: "fixture replayed history" },
      },
    });
    return {};
  })
  .onRequest(acp.methods.agent.session.resume, ({ params }) => {
    sessions.add(params.sessionId);
    return {};
  })
  .onRequest(acp.methods.agent.session.close, ({ params }) => {
    sessions.delete(params.sessionId);
    return {};
  })
  .onRequest(acp.methods.agent.session.list, () => ({
    sessions: [
      {
        sessionId: "fixture-existing",
        cwd: process.cwd(),
        title: "Fixture persisted session",
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
    ],
  }))
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (!sessions.has(params.sessionId)) throw new Error("unknown session");
    if (mode === "hang") return await new Promise(() => {});
    const permission = await client.request(
      acp.methods.client.session.requestPermission,
      {
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: "fixture-tool",
          title: "Write fixture output",
          kind: "edit",
          status: "pending",
        },
        options: [
          { optionId: "allow", name: "Allow once", kind: "allow_once" },
          { optionId: "reject", name: "Reject once", kind: "reject_once" },
        ],
      },
    );
    const allowed =
      permission.outcome.outcome === "selected" &&
      permission.outcome.optionId === "allow";
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: allowed
            ? "fixture ready; Authorization: Bearer fixture-secret"
            : "fixture permission denied",
        },
      },
    });
    return { stopReason: "end_turn" };
  })
  .onNotification(acp.methods.agent.session.cancel, () => {});

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);
app.connect(stream);
