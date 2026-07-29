import { describe, expect, it } from "vitest";

import { WEB_UI_CLIENT_SCRIPT } from "./WebUiClient.js";
import { WEB_UI_CLIENT_BINDINGS_SCRIPT } from "./WebUiClientBindings.js";
import { WEB_UI_CLIENT_APPROVAL_SCRIPT } from "./WebUiClientApproval.js";
import { WEB_UI_CLIENT_ATTACHMENTS_SCRIPT } from "./WebUiClientAttachments.js";
import { WEB_UI_CLIENT_CAPABILITIES_SCRIPT } from "./WebUiClientCapabilities.js";
import { WEB_UI_CLIENT_CONTEXT_SCRIPT } from "./WebUiClientContext.js";
import { WEB_UI_CLIENT_FOUNDATION_SCRIPT } from "./WebUiClientFoundation.js";
import { WEB_UI_CLIENT_HISTORY_SCRIPT } from "./WebUiClientHistory.js";
import { WEB_UI_CLIENT_MESSAGES_SCRIPT } from "./WebUiClientMessages.js";
import { WEB_UI_CLIENT_PALETTE_SCRIPT } from "./WebUiClientPalette.js";
import { WEB_UI_CLIENT_SELECT_SCRIPT } from "./WebUiClientSelect.js";
import { WEB_UI_CLIENT_SESSION_SCRIPT } from "./WebUiClientSession.js";
import { WEB_UI_CLIENT_SLASH_COMMANDS_SCRIPT } from "./WebUiClientSlashCommands.js";
import { BUILTIN_SLASH_COMMANDS } from "../SlashCommandCatalog.js";

describe("WEB_UI_CLIENT_SCRIPT", () => {
  it("assembles every responsibility fragment in dependency order", () => {
    const fragments = [
      WEB_UI_CLIENT_FOUNDATION_SCRIPT,
      WEB_UI_CLIENT_SELECT_SCRIPT,
      WEB_UI_CLIENT_APPROVAL_SCRIPT,
      WEB_UI_CLIENT_ATTACHMENTS_SCRIPT,
      WEB_UI_CLIENT_CONTEXT_SCRIPT,
      WEB_UI_CLIENT_MESSAGES_SCRIPT,
      WEB_UI_CLIENT_HISTORY_SCRIPT,
      WEB_UI_CLIENT_CAPABILITIES_SCRIPT,
      WEB_UI_CLIENT_SESSION_SCRIPT,
      WEB_UI_CLIENT_SLASH_COMMANDS_SCRIPT,
      WEB_UI_CLIENT_PALETTE_SCRIPT,
      WEB_UI_CLIENT_BINDINGS_SCRIPT,
    ];

    let previousIndex = -1;
    for (const fragment of fragments) {
      const fragmentIndex = WEB_UI_CLIENT_SCRIPT.indexOf(fragment);
      expect(fragmentIndex).toBeGreaterThan(previousIndex);
      previousIndex = fragmentIndex;
    }
  });

  it("produces one executable browser controller with its existing endpoints", () => {
    expect(() => new Function(WEB_UI_CLIENT_SCRIPT)).not.toThrow();
    expect(WEB_UI_CLIENT_SCRIPT).toContain("fetch('/api/bootstrap'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("api('/api/messages?limit=60')");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("api('/api/chat'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("api('/api/approval'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "renderPendingApproval(data.approval)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("api('/api/completions?query='");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("new EventSource(eventUrl");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function updateSendButtonState() ");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "syncSkillControls(Boolean(\n      state.skills",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("!state.ready || !hasPrompt");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("if (!state.ready)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("event.type === 'ui_turn_started'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "event.type === 'ui_turn_completed'",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("isControlCommand(value)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("upsertControlTurn(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("renderControlTurn(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("preservePosition");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "async function loadEarlierMessages(options)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("updateMessageNavigation()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "renderMessages({ forceBottom: true })",
    );
    for (const command of BUILTIN_SLASH_COMMANDS) {
      expect(WEB_UI_CLIENT_SCRIPT).toContain(`\"${command}\"`);
    }
    expect(WEB_UI_CLIENT_SCRIPT).toContain("message-progress");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("message-model");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("setStreamingModel(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("orbitAvatarTemplate");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("cloneNode(true)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("code-lines");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("is-addition");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("expand-code");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("appendHighlightedCodeLine");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("'token-' + type");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("setStreamingProgress(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("createMarkdownTable(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("isMarkdownTableDivider(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("copy.copyResponse");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("upsertStreamingTool(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("updateToolCard(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("block.summary || ''");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("payload.display || ''");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("state.streamingTools.clear()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "summary.setAttribute('aria-expanded', String(root.open))",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("contextWindow: 'Context'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("copy.contextWindow");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "Number(value || 0).toLocaleString()",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("orbit.webui.bootstrap-token");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "async function recoverSessionCookie()",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("fetch(location.pathname || '/'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "response.status === 401 && await recoverSessionCookie()",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("sessionStorage.getItem");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function readLocalStorage(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function writeLocalStorage(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("systemThemeQuery.matches");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("orbit.webui.sidebar");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("orbit.webui.project");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "function renderProjectNavigation(projects, currentWorkspace)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("button.dataset.projectPath");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "window.location.assign(target.href)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("const switchToProject");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("elements.projectList");
    expect(WEB_UI_CLIENT_SCRIPT).toContain('data-project-action="remove"');
    expect(WEB_UI_CLIENT_SCRIPT).toContain("confirmRemoveProject");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("item.available === true");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("action: 'pick'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("pickAndOpenProject");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "function setDesktopSidebarCollapsed(collapsed)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function toggleNavigation()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("'Toggle navigation'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("const desktopCollapsed = !mobile");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "copy.recentSession + ': ' + (session.title || copy.untitledTask)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "button.setAttribute('aria-current', 'page')",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("if (!isActive)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("data-session-action");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("openSessionDeleteDialog");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("pendingSessionDeleteId");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("elements.archivedSessions");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("formatPermissionMode(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("item.dataset.message === text");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("response.status === 401");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("useBearerTransport");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("access_token=");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "byId('retryConnection').addEventListener('click', () => void initialize())",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("webSessionToken = ''");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("state.ready = true");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "elements.appShell.classList.add('is-reconnecting')",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("await recoverSessionCookie()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "retryAttempt < 2 ? 'connecting' : 'disconnected'",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("openCommandPalette()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("label + '. ' + copy.retry");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("retry: 'Retry now'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("retry: '立即重试'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("buildPaletteActions()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function renderSlashCommands()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function loadSlashCommands()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("slash-command-option-");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("result.commands");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "definition.command + (definition.usage",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("trapInspectorFocus");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "elements.workspaceView.inert = inspectorOpen || sidebarOpen",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("setInspector(true, 'tasks')");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("renderTaskOverview(data)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("handleInspectorTabKeydown");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("elements.activityTab.tabIndex");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("syncSearchSettings(Boolean(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("api('/api/skills')");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function renderSkills(data)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "requestId === state.skillRequestId",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "elements.refreshSkills.setAttribute('aria-busy'",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("skill.defaultPrompt");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("skill.allowImplicitInvocation");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("copy.useSkill");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("skillsDisabled");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("skill.disabled = !input.checked");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "row.classList.toggle('is-disabled', skill.disabled)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("capabilityTemplates");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("updateCapabilityPreview");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "format: 'orbit-capability-catalog'",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("applyActivityFilter");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("state.changeQuery");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("copy.copyDiff");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function initializeSelectControl(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("elements.providerSelect");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("syncProviderOptions(data)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("settingsPromise");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("previousRequest");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("loadSkills(true).catch");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("await state.settingsPromise");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("capabilityFormError");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("capabilitySkillsMissing");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("toast.setAttribute('role'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "applySettings({ provider: elements.providerSelect.value }",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function positionSelectMenu(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("className = 'select-search'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("No matching models");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("document.body.append(menu)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("closeOpenSelectControls(true)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("aria-activedescendant");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("'command-result-' + index");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("event.key === 'End'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function openContextPicker()");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function addContextFile(index)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function renderContextShelf(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function removeContextFile(path)");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("submitTurn('/drop ' + path");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("submitTurn('/drop all'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("api('/api/task'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "['plan', 'parallel-improve'].includes(action)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "['agent_start', 'agent_spawn', 'agent_status', 'agent_completed']",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("copy.contextAdded");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("async function uploadAttachment(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function queuePrompt(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("orbit.webui.queue");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("toast.append(body, close)");
    expect(WEB_UI_CLIENT_SCRIPT).not.toContain(
      "toast.append(document.createElement('span'), body, close)",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain("function renderChangeReview(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("event.type === 'file_diff'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("appendStreamingDiff(");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("change-diff-line");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("api('/api/review'");
    expect(WEB_UI_CLIENT_SCRIPT).toContain("{ restoreDraft: draft }");
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "button.setAttribute('aria-pressed', active ? 'true' : 'false')",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toContain(
      "elements.contextPercent.textContent",
    );
    expect(WEB_UI_CLIENT_SCRIPT).toMatch(/initialize\(\);\s*\}\)\(\);\s*$/);
  });
});
