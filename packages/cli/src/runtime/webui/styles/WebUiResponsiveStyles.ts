/** Viewport adaptations and reduced-motion accessibility overrides. */
export const WEB_UI_RESPONSIVE_STYLES = String.raw`
@media (hover: none), (pointer: coarse) {
  .session-actions,
  .registered-project-remove {
    opacity: 1;
  }
}

@media (min-width: 901px) {
  .app-shell.sidebar-collapsed {
    grid-template-columns: 0 minmax(0, 1fr);
    gap: 0;
    padding-left: 8px;
  }

  .app-shell.sidebar-collapsed .sidebar {
    opacity: 0;
    pointer-events: none;
    transform: translateX(-18px);
  }

  .app-shell.sidebar-collapsed .mobile-menu {
    display: grid;
  }
}

@media (max-width: 1320px) {
  :root {
    --sidebar-width: 232px;
    --content-width: 820px;
    --composer-width: 840px;
  }

  .details-button span:last-child {
    display: none;
  }

  .details-button {
    width: 34px;
    justify-content: center;
    padding: 0;
  }

  .command-trigger span,
  .command-trigger kbd,
  .context-meter-copy small {
    display: none;
  }

  .command-trigger {
    width: 34px;
    justify-content: center;
    padding: 0;
  }

  .context-meter {
    justify-content: center;
  }
}

@media (max-width: 1200px) {
  .topbar {
    position: relative;
    gap: 8px;
    padding-inline: 12px;
  }

  .topbar-actions {
    position: absolute;
    right: 12px;
    gap: 4px;
  }

  .command-trigger {
    display: none;
  }

  .context-meter,
  .workspace-heading span {
    display: none;
  }

  .provider-select-trigger {
    width: 112px;
  }

  .model-select-trigger {
    width: min(180px, 20vw);
  }

  .workspace-heading strong,
  .workspace-heading span {
    max-width: 26vw;
  }
}

@media (max-width: 1100px) {
  .connection-state span:last-child,
  .context-meter-copy {
    display: none;
  }

  .context-meter {
    width: 34px;
    padding: 0;
  }
}

@media (max-width: 900px) {
  .app-shell {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
    padding: 0;
  }

  .workspace-view {
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(280px, calc(100vw - 54px));
    padding: 14px 12px 10px;
    background:
      radial-gradient(circle at 18% 0%, var(--accent-glow), transparent 30%),
      var(--sidebar);
    border-right: 1px solid var(--sidebar-border);
    box-shadow: var(--shadow-lg);
    transform: translateX(-105%);
    transition: transform 210ms cubic-bezier(0.2, 0.75, 0.3, 1);
  }

  .sidebar-collapse-button {
    display: none;
  }

  .app-shell.sidebar-open .sidebar {
    transform: translateX(0);
  }

  .app-shell.sidebar-open .sidebar-backdrop {
    display: block;
  }

  .mobile-menu {
    display: grid;
  }

  .model-select-trigger {
    width: min(210px, 36vw);
  }

  .provider-select-trigger {
    width: min(145px, 24vw);
  }

  .message-column {
    width: min(var(--content-width), calc(100% - 32px));
    padding-top: 32px;
  }

  .empty-state {
    width: min(760px, calc(100% - 40px));
    padding-top: clamp(56px, 10vh, 94px);
  }

  .suggestion-card {
    min-height: 60px;
  }

}

@media (min-width: 1680px) {
  :root {
    --content-width: 920px;
    --composer-width: 940px;
  }

  .empty-state {
    width: min(var(--composer-width), calc(100% - 128px));
  }

  .empty-state h1 {
    font-size: 44px;
  }

  .empty-description {
    font-size: 15px;
  }

  .suggestion-card {
    min-height: 68px;
  }
}

@media (max-height: 760px) and (min-width: 901px) {
  .sidebar {
    gap: 5px;
  }

  .sidebar-spacer {
    min-height: 6px;
  }

  .empty-state {
    justify-content: flex-start;
    padding-top: 38px;
    padding-bottom: 24px;
  }

  .empty-composer-slot {
    margin-top: 16px;
  }

  .empty-composer-slot #prompt {
    min-height: 42px;
  }

  .suggestion-grid {
    margin-top: 10px;
  }
}

@media (max-width: 560px) {
  .project-dialog-card {
    padding: 17px;
  }

  .project-dialog-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .project-dialog-cancel {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .workspace-view {
    grid-template-rows: 54px auto minmax(0, 1fr);
  }

  .topbar {
    height: 54px;
    padding: 0 10px;
  }

  .workspace-heading span,
  .command-trigger,
  .context-meter,
  .provider-control,
  .model-control,
  .brand-version {
    display: none;
  }

  .connection-state {
    width: 32px;
    justify-content: center;
    padding: 0;
  }

  .connection-state span:last-child {
    display: none;
  }

  .workspace-heading strong {
    max-width: 52vw;
  }

  .topbar-actions {
    right: 10px;
    max-width: calc(48vw - 8px);
  }

  .message-column {
    width: calc(100% - 24px);
    gap: 23px;
    padding: 24px 0 28px;
  }

  .message {
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 9px;
  }

  .message-avatar {
    width: 28px;
    height: 24px;
  }

  .message-avatar .message-mark {
    width: 20px;
    height: 20px;
  }

  .message.user .message-content {
    max-width: 88%;
  }

  .code-header {
    gap: 6px;
    padding-left: 10px;
  }

  .code-metadata {
    max-width: 34vw;
  }

  .code-line {
    padding-right: 12px;
    padding-left: 48px;
  }

  .code-line::before {
    width: 35px;
  }

  .empty-state {
    width: calc(100% - 24px);
    justify-content: flex-start;
    padding: 38px 0 28px;
  }

  .empty-description {
    font-size: 12px;
  }

  .suggestion-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }

  .suggestion-card {
    min-height: 52px;
    gap: 8px;
    padding: 7px 9px;
  }

  .suggestion-icon {
    width: 26px;
    height: 26px;
  }

  .suggestion-copy small {
    display: none;
  }

  .composer-dock {
    width: 100%;
    padding-inline: 10px;
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }

  .empty-composer-slot .composer-dock {
    padding-inline: 0;
  }

  .empty-composer-slot {
    margin-top: 22px;
  }

  .composer {
    padding: 10px 9px 8px;
    border-radius: 16px;
  }

  .composer-hint {
    display: none;
  }

  .composer-chip {
    padding: 0 6px;
  }

  .context-shelf {
    margin-bottom: 7px;
    padding: 7px;
  }

  .context-file-list {
    max-height: none;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .context-file-chip {
    max-width: min(220px, 78vw);
    flex: 0 0 auto;
  }

  .context-picker {
    left: 0;
    width: 100%;
    max-height: min(480px, 62vh);
    border-radius: 14px;
  }

  .empty-composer-slot .context-picker {
    max-height: min(390px, 46vh);
  }

  .context-picker-hint {
    display: none;
  }

  .connection-help {
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: 8px 10px;
  }

  .connection-help button {
    grid-column: auto;
    width: auto;
  }

  .connection-help small {
    display: none;
  }

  .jump-bottom {
    bottom: 112px;
  }

  .inspector {
    inset: 0;
    width: 100%;
    border: 0;
    border-radius: 0;
    transform: translateY(104%);
  }

  .inspector.is-open {
    transform: translateY(0);
  }

  .toast-region {
    top: calc(64px + env(safe-area-inset-top));
    right: 10px;
    bottom: auto;
    width: min(420px, calc(100vw - 20px));
  }

  body:has(.toast) .jump-earlier {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -8px);
  }

  .command-palette {
    place-items: end center;
    padding: 10px;
  }

  .command-palette-dialog {
    width: 100%;
    border-radius: 17px;
  }

  .command-results {
    max-height: min(520px, 66vh);
  }
}

@media (max-width: 420px) {
  .composer-toolbar {
    gap: 8px;
  }

  #contextPickerButton,
  #attachmentButton {
    min-width: 29px;
    justify-content: center;
    padding-inline: 6px;
  }

  #contextPickerButton > span:not(.context-chip-count),
  #attachmentButton > span:not(.context-chip-count) {
    display: none;
  }

  .task-overview-stats {
    grid-template-columns: minmax(0, 1fr);
  }

  .suggestion-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .suggestion-card {
    min-height: 48px;
  }

  .empty-state h1 {
    font-size: 29px;
  }

  .empty-description {
    max-width: 34ch;
  }

  .language-options {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
