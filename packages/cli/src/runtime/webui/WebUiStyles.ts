import { WEB_UI_COMPOSER_STYLES } from "./styles/WebUiComposerStyles.js";
import { WEB_UI_APPROVAL_STYLES } from "./styles/WebUiApprovalStyles.js";
import { WEB_UI_CONTEXT_STYLES } from "./styles/WebUiContextStyles.js";
import { WEB_UI_CONVERSATION_STYLES } from "./styles/WebUiConversationStyles.js";
import { WEB_UI_FEEDBACK_STYLES } from "./styles/WebUiFeedbackStyles.js";
import { WEB_UI_FOUNDATION_STYLES } from "./styles/WebUiFoundationStyles.js";
import { WEB_UI_INSPECTOR_STYLES } from "./styles/WebUiInspectorStyles.js";
import { WEB_UI_CAPABILITIES_STYLES } from "./styles/WebUiCapabilitiesStyles.js";
import { WEB_UI_PALETTE_STYLES } from "./styles/WebUiPaletteStyles.js";
import { WEB_UI_RESPONSIVE_STYLES } from "./styles/WebUiResponsiveStyles.js";
import { WEB_UI_SELECT_STYLES } from "./styles/WebUiSelectStyles.js";
import { WEB_UI_SHELL_STYLES } from "./styles/WebUiShellStyles.js";
import { WEB_UI_BROWSER_PREVIEW_STYLES } from "./styles/WebUiBrowserPreviewStyles.js";
import { WEB_UI_WORKBENCH_STYLES } from "./styles/WebUiWorkbenchStyles.js";

const WEB_UI_STYLE_SECTIONS = [
  WEB_UI_FOUNDATION_STYLES,
  WEB_UI_SHELL_STYLES,
  WEB_UI_SELECT_STYLES,
  WEB_UI_CONVERSATION_STYLES,
  WEB_UI_COMPOSER_STYLES,
  WEB_UI_APPROVAL_STYLES,
  WEB_UI_CONTEXT_STYLES,
  WEB_UI_INSPECTOR_STYLES,
  WEB_UI_CAPABILITIES_STYLES,
  WEB_UI_PALETTE_STYLES,
  WEB_UI_FEEDBACK_STYLES,
  WEB_UI_BROWSER_PREVIEW_STYLES,
  WEB_UI_WORKBENCH_STYLES,
  WEB_UI_RESPONSIVE_STYLES,
] as const;

/**
 * Complete visual system for the local Orbit web workspace.
 *
 * Sections are composed in cascade order. Keep responsive overrides last.
 */
export const WEB_UI_STYLES = WEB_UI_STYLE_SECTIONS.join("");
