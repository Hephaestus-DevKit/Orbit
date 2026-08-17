import picocolors from "picocolors";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { ConfigLoader } from "@orbit-build/config";
import {
  AcpRegistryFileSchema,
  closeAcpAgentSession,
  fetchAcpRegistry,
  loadAcpAgentSessionHistory,
  loadAcpRegistry,
  listAcpAgentSessions,
  probeAcpAgent,
  runAcpAgentPrompt,
  type AcpPermissionRequest,
  type AcpUpdateSnapshot,
} from "@orbit-build/acp";
import { Prompt } from "@orbit-build/tui";
import {
  canonicalJsonStringify,
  generateId,
  readBoundedRegularFile,
  redactSecrets,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";
import {
  SessionManager,
  type StoredHistoryMessage,
} from "@orbit-build/session";

export interface AcpCommandOptions {
  cwd?: string;
  json?: boolean;
  jsonl?: boolean;
  sessionId?: string;
  sessionRestore?: "auto" | "resume" | "load";
  title?: string;
  force?: boolean;
  allowTruncated?: boolean;
}

type AcpAction = "list" | "sessions" | "close" | "import" | "probe" | "run";

export type AcpRegistryAction = "list" | "validate";

export interface AcpRegistryCommandOptions extends Pick<
  AcpCommandOptions,
  "cwd" | "json"
> {
  requireSignature?: boolean;
  url?: string;
  out?: string;
  registryId?: string;
  owner?: string;
  force?: boolean;
  allowUnsigned?: boolean;
}

export interface AcpRegistryFetchResult {
  action: "fetch";
  url: string;
  outputPath: string;
  registryId: string;
  owner: string;
  revision: number;
  digest: string;
  signatureStatus: string;
  notModified: boolean;
}

/** Inspect local ACP manifests without spawning or trusting external agents. */
export function runAcpRegistryCommand(
  action: AcpRegistryAction,
  options: AcpRegistryCommandOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const config = ConfigLoader.loadSync(cwd);
  const requireSignature =
    options.requireSignature === true ||
    config.security?.requireSignedAcpRegistry === true;
  const snapshot = loadAcpRegistry(cwd, undefined, {
    trustRoots: config.security?.acpRegistryTrustRoots ?? {},
    requireSignature,
  });
  const invalid = snapshot.diagnostics.filter((item) => !item.ok);
  if (action === "validate") {
    const result = {
      schemaVersion: 1,
      ok: invalid.length === 0,
      entries: snapshot.entries.length,
      requireSignature,
      diagnostics: snapshot.diagnostics,
    };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (result.ok)
      console.log(
        picocolors.green(
          `✔ ACP registry valid (${result.entries} ${result.entries === 1 ? "entry" : "entries"}).`,
        ),
      );
    else {
      console.error(
        picocolors.red(`✖ ACP registry has ${invalid.length} invalid file(s).`),
      );
      for (const item of invalid)
        console.error(`  ${item.scope}: ${item.path} · ${item.error}`);
    }
    return result.ok ? 0 : 1;
  }
  const result = {
    schemaVersion: 1,
    entries: snapshot.entries.map(
      ({ entry, scope, path, digest, signatureStatus }) => ({
        ...entry,
        scope,
        path,
        digest,
        signatureStatus,
      }),
    ),
    requireSignature,
    diagnostics: snapshot.diagnostics,
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.entries.length === 0) {
    console.log("No local ACP registry entries discovered.");
    for (const item of invalid)
      console.error(
        picocolors.yellow(`⚠ ${item.scope}: ${item.path} · ${item.error}`),
      );
  } else {
    console.log(
      picocolors.bold(`\nLocal ACP registry (${result.entries.length})\n`),
    );
    for (const entry of result.entries) {
      const state = entry.enabled
        ? picocolors.green("enabled")
        : picocolors.gray("disabled");
      const trust =
        entry.trust === "trusted"
          ? picocolors.green("trusted")
          : picocolors.yellow("untrusted");
      const signature =
        entry.signatureStatus === "valid"
          ? picocolors.green("signed")
          : picocolors.gray("unsigned");
      console.log(
        `${picocolors.cyan(entry.id)} · ${state} · ${trust} · ${signature} · ${entry.title}`,
      );
      console.log(
        picocolors.gray(`  ${entry.scope} · ${entry.command} · ${entry.path}`),
      );
    }
    for (const item of invalid)
      console.error(
        picocolors.yellow(`⚠ ${item.scope}: ${item.path} · ${item.error}`),
      );
  }
  return 0;
}

/** Fetch, verify, and atomically pin one hosted ACP registry in the project. */
export async function runAcpRegistryFetchCommand(
  options: AcpRegistryCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const url = options.url?.trim();
  if (!url) return emitError("acp registry fetch requires --url.", options);
  const config = ConfigLoader.loadSync(cwd);
  try {
    const outputPath = resolveSafePath(
      cwd,
      options.out?.trim() || ".orbit/acp/registry.json",
    );
    const fetched = await fetchAcpRegistry({
      url,
      trustRoots: config.security?.acpRegistryTrustRoots ?? {},
      expectedRegistryId: options.registryId,
      expectedOwner: options.owner,
      requireSignature:
        config.security?.requireSignedAcpRegistry === true ||
        options.allowUnsigned !== true,
    });
    const previous = readExistingRegistry(outputPath);
    if (previous && !options.force) {
      if (
        previous.metadata?.registryId !== fetched.metadata.registryId ||
        previous.metadata.revision > fetched.metadata.revision
      ) {
        throw new Error(
          "Existing ACP registry belongs to another owner or has a newer revision; rerun with --force only after review.",
        );
      }
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    replacePrivateFileAtomically(
      outputPath,
      `${JSON.stringify(fetched.file, null, 2)}\n`,
    );
    const result: AcpRegistryFetchResult = {
      action: "fetch",
      url: fetched.url,
      outputPath,
      registryId: fetched.metadata.registryId,
      owner: fetched.metadata.owner,
      revision: fetched.metadata.revision,
      digest: fetched.digest,
      signatureStatus: fetched.signatureStatus,
      notModified: fetched.notModified,
    };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      const state = fetched.notModified ? "unchanged" : "updated";
      console.log(
        picocolors.green(
          `✔ Hosted ACP registry ${state}: ${fetched.metadata.registryId} r${fetched.metadata.revision} (${fetched.signatureStatus}).`,
        ),
      );
      console.log(picocolors.gray(`  ${outputPath} · ${fetched.digest}`));
    }
    return 0;
  } catch (error: unknown) {
    return emitError(errorMessage(error), options);
  }
}

function readExistingRegistry(
  outputPath: string,
): import("@orbit-build/acp").AcpRegistryFile | undefined {
  if (!existsSync(outputPath)) return undefined;
  const raw = readBoundedRegularFile(outputPath, 512 * 1024, {
    allowSymbolicLink: false,
  });
  if (raw === undefined) return undefined;
  const parsed = AcpRegistryFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(
      "Existing ACP registry is malformed; refusing to replace it.",
    );
  return parsed.data;
}

/** Manage configured ACP external agents without mixing them with Providers. */
export async function runAcpCommand(
  action: AcpAction,
  agentId?: string,
  prompt?: string,
  options: AcpCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const config = ConfigLoader.loadSync(cwd);
  if (action !== "list" && config.managedPolicy?.disableExternalAgents) {
    return emitError("Managed policy disables external ACP agents.", options);
  }
  const agents = config.externalAgents;
  if (action === "list") {
    const entries = Object.entries(agents).map(([id, candidate]) => ({
      id,
      command: candidate.command,
      args: candidate.args,
      enabled: candidate.enabled,
      permissionPolicy: candidate.permissionPolicy,
      requestTimeoutMs: candidate.requestTimeoutMs,
    }));
    if (options.json)
      console.log(
        JSON.stringify({ schemaVersion: 1, agents: entries }, null, 2),
      );
    else if (entries.length === 0)
      console.log("No ACP external agents configured.");
    else {
      console.log(
        picocolors.bold(`\nACP external agents (${entries.length})\n`),
      );
      for (const entry of entries) {
        const state = entry.enabled
          ? picocolors.green("enabled")
          : picocolors.gray("disabled");
        console.log(
          `${picocolors.cyan(entry.id)} · ${state} · ${entry.command}`,
        );
        console.log(
          picocolors.gray(
            `  timeout ${entry.requestTimeoutMs}ms · permission ${entry.permissionPolicy}`,
          ),
        );
      }
    }
    return 0;
  }

  if (!agentId)
    return emitError(`acp ${action} requires an agent id.`, options);
  const agent = agents[agentId];
  if (!agent)
    return emitError(`ACP external agent not found: ${agentId}.`, options);
  if (action === "close") {
    const sessionId = prompt?.trim();
    if (!sessionId)
      return emitError("acp close requires a session id.", options);
    try {
      const result = await closeAcpAgentSession(sessionId, {
        cwd,
        config: agent,
        clientVersion: "orbit",
      });
      if (options.json) {
        console.log(
          JSON.stringify({ schemaVersion: 1, agentId, ...result }, null, 2),
        );
      } else {
        console.log(
          picocolors.green(
            `✔ Closed ACP session ${result.sessionId} on ${agentId}.`,
          ),
        );
      }
      return 0;
    } catch (error: unknown) {
      return emitError(errorMessage(error), options);
    }
  }
  if (action === "sessions") {
    try {
      const result = await listAcpAgentSessions({
        cwd,
        config: agent,
        clientVersion: "orbit",
      });
      if (options.json) {
        console.log(
          JSON.stringify({ schemaVersion: 1, agentId, ...result }, null, 2),
        );
      } else if (result.sessions.length === 0) {
        console.log(`No ACP sessions exposed by ${agentId}.`);
      } else {
        console.log(
          picocolors.bold(
            `\nACP sessions for ${agentId} (${result.sessions.length})\n`,
          ),
        );
        for (const session of result.sessions) {
          console.log(
            `${picocolors.cyan(session.sessionId)} · ${session.title || "untitled"}`,
          );
          console.log(
            picocolors.gray(
              `  ${session.cwd}${session.updatedAt ? ` · ${session.updatedAt}` : ""}`,
            ),
          );
        }
      }
      return 0;
    } catch (error: unknown) {
      return emitError(errorMessage(error), options);
    }
  }
  if (action === "import") {
    const externalSessionId = prompt?.trim();
    if (!externalSessionId)
      return emitError("acp import requires a session id.", options);
    try {
      const imported = await importAcpHistory(
        cwd,
        agentId,
        externalSessionId,
        agent,
        options,
      );
      if (options.json) {
        console.log(JSON.stringify({ schemaVersion: 1, ...imported }, null, 2));
      } else if (imported.existing) {
        console.log(
          picocolors.gray(
            `ACP history is already imported as Orbit session ${imported.sessionId}.`,
          ),
        );
      } else {
        console.log(
          picocolors.green(
            `✔ Imported ACP history as Orbit session ${imported.sessionId} (${imported.messageCount} message(s)).`,
          ),
        );
      }
      return 0;
    } catch (error: unknown) {
      return emitError(errorMessage(error), options);
    }
  }
  if (action === "probe") {
    try {
      const capabilities = await probeAcpAgent({
        cwd,
        config: agent,
        clientVersion: "orbit",
      });
      if (options.json)
        console.log(
          JSON.stringify({ schemaVersion: 1, agentId, capabilities }, null, 2),
        );
      else {
        console.log(
          picocolors.green(
            `✔ ${agentId} negotiated ACP v${capabilities.protocolVersion}.`,
          ),
        );
        console.log(
          `  ${capabilities.title} ${picocolors.gray(`(${capabilities.version})`)}`,
        );
        console.log(
          picocolors.gray(
            `  sessions: load=${capabilities.loadSession} resume=${capabilities.sessionResume} close=${capabilities.sessionClose}`,
          ),
        );
      }
      return 0;
    } catch (error: unknown) {
      return emitError(errorMessage(error), options);
    }
  }

  const trimmedPrompt = prompt?.trim();
  if (!trimmedPrompt)
    return emitError("acp run requires a non-empty prompt.", options);
  try {
    const result = await runAcpAgentPrompt(trimmedPrompt, {
      cwd,
      config: agent,
      clientVersion: "orbit",
      sessionId: options.sessionId,
      sessionRestore: options.sessionRestore,
      requestPermission: options.jsonl
        ? undefined
        : (request) => askPermission(request),
      onUpdate: (update) => {
        if (options.jsonl) {
          console.log(
            JSON.stringify({
              schemaVersion: 1,
              type: "session_update",
              ...update,
            }),
          );
        } else if (update.sessionUpdate === "agent_message_chunk") {
          const text = extractText(update.data);
          if (text) process.stdout.write(text);
        } else if (update.sessionUpdate === "tool_call") {
          console.error(
            picocolors.gray(`\n● External Agent: ${extractTitle(update.data)}`),
          );
        }
      },
    });
    if (options.json || options.jsonl) {
      console.log(
        JSON.stringify(
          { schemaVersion: 1, type: "completed", agentId, ...result },
          null,
          options.jsonl ? 0 : 2,
        ),
      );
    } else {
      if (result.text && !result.text.endsWith("\n"))
        process.stdout.write("\n");
      console.log(
        picocolors.gray(
          `✔ ACP turn completed: ${result.stopReason} · ${result.updateCount} update(s)`,
        ),
      );
      if (result.restoredSession) {
        console.log(
          picocolors.gray(
            `  continued ${result.sessionId} via ${result.restoredSession.strategy} · replayed ${result.restoredSession.replayedUpdateCount} update(s)`,
          ),
        );
      }
      if (result.stderr)
        console.error(
          picocolors.gray(`External Agent stderr:\n${result.stderr}`),
        );
    }
    return 0;
  } catch (error: unknown) {
    return emitError(errorMessage(error), options);
  }
}

interface AcpImportResult {
  action: "import";
  agentId: string;
  externalSessionId: string;
  sessionId: string;
  digest: string;
  updateCount: number;
  messageCount: number;
  truncated: boolean;
  existing: boolean;
}

async function importAcpHistory(
  cwd: string,
  agentId: string,
  externalSessionId: string,
  config: Parameters<typeof loadAcpAgentSessionHistory>[1]["config"],
  options: AcpCommandOptions,
): Promise<AcpImportResult> {
  const history = await loadAcpAgentSessionHistory(externalSessionId, {
    cwd,
    config,
    clientVersion: "orbit",
  });
  if (history.truncated && !options.allowTruncated) {
    throw new Error(
      `ACP history exceeded the import limit after ${history.updateCount} update(s); rerun with --allow-truncated to import the bounded prefix explicitly.`,
    );
  }
  const messages = mapAcpHistoryToOrbit(
    agentId,
    externalSessionId,
    history.updates,
  );
  if (messages.length === 0) {
    throw new Error("ACP session/load returned no importable history.");
  }
  const digest = createHash("sha256")
    .update(
      canonicalJsonStringify({
        externalSessionId,
        updates: history.updates.map(({ sessionUpdate, data }) => ({
          sessionUpdate,
          data,
        })),
        updateCount: history.updateCount,
        truncated: history.truncated,
      }),
      "utf8",
    )
    .digest("hex");
  const manager = new SessionManager(cwd);
  const store = manager.getSessionStore();
  if (!options.force) {
    const duplicate = store.listSessions().find((session) =>
      store.getEvents(session.id).some((event) => {
        if (event.type !== "acp_history_imported" || !isRecord(event.payload))
          return false;
        return (
          event.payload.agentId === agentId &&
          event.payload.externalSessionId === externalSessionId &&
          event.payload.digest === digest
        );
      }),
    );
    if (duplicate) {
      return {
        action: "import",
        agentId,
        externalSessionId,
        sessionId: duplicate.id,
        digest,
        updateCount: history.updateCount,
        messageCount: messages.length,
        truncated: history.truncated,
        existing: true,
      };
    }
  }

  const requestedTitle = options.title?.trim();
  if (requestedTitle && requestedTitle.length > 200) {
    throw new Error("Imported ACP session title cannot exceed 200 characters.");
  }
  const session = manager.startNewSession(`acp:${agentId}`, "external-history");
  try {
    manager.setTitle(
      requestedTitle ||
        `Imported ${agentId}: ${externalSessionId}`.slice(0, 200),
    );
    manager.setGoal(
      `Read-only import of ACP session ${externalSessionId} from ${agentId}.`,
    );
    manager.saveHistory(messages);
    manager.logEvent("acp_history_imported", {
      agentId,
      externalSessionId,
      digest,
      updateCount: history.updateCount,
      messageCount: messages.length,
      truncated: history.truncated,
      importedAt: new Date().toISOString(),
    });
    manager.setStatus("completed");
  } catch (error) {
    store.deleteSession(session.id);
    throw error;
  }
  return {
    action: "import",
    agentId,
    externalSessionId,
    sessionId: session.id,
    digest,
    updateCount: history.updateCount,
    messageCount: messages.length,
    truncated: history.truncated,
    existing: false,
  };
}

/** Convert ACP replay updates to inert, provenance-tagged Orbit history. */
export function mapAcpHistoryToOrbit(
  agentId: string,
  externalSessionId: string,
  updates: AcpUpdateSnapshot[],
): StoredHistoryMessage[] {
  const messages: StoredHistoryMessage[] = [];
  const grouped = new Map<string, number>();
  let anonymousGroup = 0;
  let previousAnonymousType = "";
  let previousAnonymousKey = "";
  for (const update of updates) {
    const data = isRecord(update.data) ? update.data : {};
    const updateType =
      typeof data.sessionUpdate === "string"
        ? data.sessionUpdate
        : update.sessionUpdate;
    const role = updateType === "user_message_chunk" ? "user" : "assistant";
    const content = importableAcpContent(updateType, data);
    if (!content) continue;
    const externalMessageId =
      typeof data.messageId === "string" && data.messageId.trim()
        ? data.messageId.slice(0, 512)
        : undefined;
    let groupKey: string;
    if (externalMessageId) {
      groupKey = `${role}:${updateType}:${externalMessageId}`;
      previousAnonymousType = "";
      previousAnonymousKey = "";
    } else if (previousAnonymousType === `${role}:${updateType}`) {
      groupKey = previousAnonymousKey;
    } else {
      anonymousGroup += 1;
      groupKey = `anonymous:${anonymousGroup}`;
      previousAnonymousType = `${role}:${updateType}`;
      previousAnonymousKey = groupKey;
    }
    const existingIndex = grouped.get(groupKey);
    if (existingIndex !== undefined) {
      const block = messages[existingIndex].content[0];
      if (block.type === content.type) block.text += content.text;
      continue;
    }
    grouped.set(groupKey, messages.length);
    messages.push({
      id: generateId("msg"),
      role,
      content: [content],
      createdAt: update.receivedAt,
      metadata: {
        source: "acp-import",
        externalAgentId: agentId,
        externalSessionId,
        sessionUpdate: updateType,
        ...(externalMessageId ? { externalMessageId } : {}),
        nonExecutable: true,
      },
    });
  }
  return messages;
}

function importableAcpContent(
  updateType: string,
  data: Record<string, unknown>,
):
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | undefined {
  if (
    updateType === "user_message_chunk" ||
    updateType === "agent_message_chunk" ||
    updateType === "agent_thought_chunk"
  ) {
    const content = isRecord(data.content) ? data.content : {};
    const text =
      content.type === "text" && typeof content.text === "string"
        ? redactSecrets(content.text)
        : `[ACP ${String(content.type || "non-text")} content omitted from imported history]`;
    return updateType === "agent_thought_chunk"
      ? { type: "thinking", text }
      : { type: "text", text };
  }
  if (
    updateType === "tool_call" ||
    updateType === "tool_call_update" ||
    updateType === "plan" ||
    updateType === "plan_update" ||
    updateType === "plan_removed"
  ) {
    return {
      type: "text",
      text: `[ACP ${updateType} evidence — inert import]\n${redactSecrets(canonicalJsonStringify(data)).slice(0, 32_000)}`,
    };
  }
  return undefined;
}

async function askPermission(
  request: AcpPermissionRequest,
): Promise<string | undefined> {
  const selected = await Prompt.askSelect(
    `External Agent requests: ${request.title}`,
    request.options.map((option) => ({
      value: option.id,
      label: `${option.name} (${option.kind})`,
    })),
  );
  return selected ?? undefined;
}

function extractText(value: unknown): string {
  if (!isRecord(value) || value.sessionUpdate !== "agent_message_chunk")
    return "";
  const content = value.content;
  return isRecord(content) &&
    content.type === "text" &&
    typeof content.text === "string"
    ? content.text
    : "";
}

function extractTitle(value: unknown): string {
  return isRecord(value) && typeof value.title === "string"
    ? redactSecrets(value.title).slice(0, 500)
    : "tool call";
}

function emitError(message: string, options: AcpCommandOptions): number {
  if (options.json || options.jsonl)
    console.log(
      JSON.stringify({ schemaVersion: 1, ok: false, error: message }),
    );
  else console.error(picocolors.red(`✖ ${message}`));
  return 1;
}

function errorMessage(error: unknown): string {
  return redactSecrets(
    error instanceof Error ? error.message : String(error),
  ).slice(0, 2_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
