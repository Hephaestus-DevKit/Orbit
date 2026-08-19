import { WEB_UI_CLIENT_BINDINGS_SCRIPT } from "./WebUiClientBindings.js";
import { WEB_UI_CLIENT_CAPABILITIES_SCRIPT } from "./WebUiClientCapabilities.js";
import { WEB_UI_CLIENT_APPROVAL_SCRIPT } from "./WebUiClientApproval.js";
import { WEB_UI_CLIENT_ATTACHMENTS_SCRIPT } from "./WebUiClientAttachments.js";
import { WEB_UI_CLIENT_CONTEXT_SCRIPT } from "./WebUiClientContext.js";
import { WEB_UI_CLIENT_FOUNDATION_SCRIPT } from "./WebUiClientFoundation.js";
import { WEB_UI_CLIENT_HISTORY_SCRIPT } from "./WebUiClientHistory.js";
import { WEB_UI_CLIENT_INSPECTOR_SCRIPT } from "./WebUiClientInspector.js";
import { WEB_UI_CLIENT_MESSAGES_SCRIPT } from "./WebUiClientMessages.js";
import { WEB_UI_CLIENT_MISSION_CONTROL_SCRIPT } from "./WebUiClientMissionControl.js";
import { WEB_UI_CLIENT_PALETTE_SCRIPT } from "./WebUiClientPalette.js";
import { WEB_UI_CLIENT_SELECT_SCRIPT } from "./WebUiClientSelect.js";
import { WEB_UI_CLIENT_SESSION_SCRIPT } from "./WebUiClientSession.js";
import { WEB_UI_CLIENT_SLASH_COMMANDS_SCRIPT } from "./WebUiClientSlashCommands.js";

const WEB_UI_CLIENT_PREAMBLE = String.raw`(() => {
  'use strict';

`;

const WEB_UI_CLIENT_EPILOGUE = String.raw`})();
`;

/** Browser-side controller served as a same-origin static asset. */
export const WEB_UI_CLIENT_SCRIPT = [
  WEB_UI_CLIENT_PREAMBLE,
  WEB_UI_CLIENT_FOUNDATION_SCRIPT,
  WEB_UI_CLIENT_INSPECTOR_SCRIPT,
  WEB_UI_CLIENT_SELECT_SCRIPT,
  WEB_UI_CLIENT_APPROVAL_SCRIPT,
  WEB_UI_CLIENT_ATTACHMENTS_SCRIPT,
  WEB_UI_CLIENT_CONTEXT_SCRIPT,
  WEB_UI_CLIENT_MESSAGES_SCRIPT,
  WEB_UI_CLIENT_HISTORY_SCRIPT,
  WEB_UI_CLIENT_CAPABILITIES_SCRIPT,
  WEB_UI_CLIENT_MISSION_CONTROL_SCRIPT,
  WEB_UI_CLIENT_SESSION_SCRIPT,
  WEB_UI_CLIENT_SLASH_COMMANDS_SCRIPT,
  WEB_UI_CLIENT_PALETTE_SCRIPT,
  WEB_UI_CLIENT_BINDINGS_SCRIPT,
  WEB_UI_CLIENT_EPILOGUE,
].join("");
