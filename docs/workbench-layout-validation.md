# WebUI workbench layout validation

## Sidebar and browser-status readability follow-up (2026-09-27)

- Project paths and recent-chat metadata now use a slightly larger mono scale
  and the existing stronger sidebar text token. Section labels, count badges,
  and empty-list text also gained a small size adjustment. The sidebar width
  and browser viewport geometry were not enlarged to make room.
- Ellipsized recent-project names and paths expose their full values through
  native titles. The browser's live/not-open status is 12px and uses the primary ink
  token; action buttons and the footer structure remain unchanged.
- The authenticated desktop journey checks actual computed font sizes, path
  disclosure, sidebar/document overflow, 1440px light and 1100px dark
  screenshots, and browser console/page errors. It passed alongside 327 focused
  WebUI tests, workspace lint, architecture verification, and a CLI build. The
  final full run passed 2,005 Vitest checks with six existing skips.

## Delivered layout

- Navigation is project/conversation-focused. Commands and Settings are fixed at
  the bottom; task surfaces are launched from the workspace header.
- Browser, Changes and Run share one nonmodal right-hand workbench. Changes and
  Run no longer put a scrim over chat. Their mounted panels retain local state.
- Settings use an independent modal surface with keyboard containment, section
  navigation, and focus return. Existing project settings and permission
  semantics are unchanged.
- Provider/model selection sits with the composer. Agent search is named
  explicitly, separately from browsing. The queue action is hidden while idle.
- Browser chrome has one workbench header and one compact footer. Hiding or
  switching the surface preserves the browser session; closing the browser still
  destroys that temporary session.
- At narrower desktop widths navigation yields its space temporarily without
  overwriting the saved sidebar preference. Split view reserves at least 420px
  for chat and 640px for the browser; smaller workspaces use the existing focused
  surface fallback. Changes/Run require less width than a website.
- Existing Orbit colors and identity remain. Nested navigation borders, composer
  shadows, and empty-state suggestion density have been reduced.

## Interaction evidence

The real authenticated WebUI server was exercised with installed Edge through
Playwright. The browser surface used a real isolated Chromium page served from a
test-local web server; no website HTML was placed in Orbit's document.

- English, Simplified Chinese and Traditional Chinese browser flows passed:
  navigation, typing/IME, pointer input, tabs, website dialogs, keyboard resize,
  focus/split view and draft-only Agent reference.
- Browser → Changes → Run → Browser retains the active remote page and draft.
  Arrow keys/Home move focus and selection within the workbench tab list.
- Settings opens independently above the workbench and returns to it on Escape.
  Task/activity scroll positions survive switching and closing/reopening.
- Screenshots were inspected at 1440×1000 and 1100×760 in light/dark themes.
  The 1100px test checks both visible chat and a browser stage at least 640px wide.
- Existing tests retain reconnect, stale-session frames, stop/cleanup, approval,
  Full Access confirmation, context/attachments, streaming and workflow coverage.

Screenshots: `output/workbench-layout/browser-zh-live.png`,
`browser-zh-narrow.png`, `browser-zh-dark.png`, `task-center-desktop.png`, and
`settings-polish-1280.png`.

## Verification

Commands use the repository-pinned pnpm 10.34.5 via its Corepack installation.

| Check                                               | Result / evidence                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test` with bundled Python on the process PATH | 261 files passed, 1,885 tests passed and 6 skipped (`tmp/workbench-vitest-final.txt`)                                     |
| `pnpm verify:webui`                                 | 259 tests passed; client types, scoped lint/format and CLI build passed (`tmp/workbench-verify-webui.txt`)                |
| `pnpm test:webui:e2e`                               | 44 passed, 1 opt-in public-network smoke skipped (`tmp/workbench-e2e-final.txt`)                                          |
| Additional task/activity scroll E2E                 | Passed after adding closed-panel scroll restoration coverage (`tmp/workbench-scroll-final.txt`)                           |
| `pnpm build`                                        | All workspace package builds passed (`tmp/workbench-build-final.txt`)                                                     |
| `pnpm lint`                                         | Passed (`tmp/workbench-lint-final.txt`)                                                                                   |
| `pnpm verify:architecture`                          | Passed (`tmp/workbench-architecture.txt`)                                                                                 |
| `pnpm format:check`                                 | Existing unrelated `docs/design-impasto-validation.md` remains unformatted; not edited (`tmp/workbench-format-check.txt`) |

Initial full-suite execution found an outdated composer-shadow assertion and a
Python-launcher environment failure. The assertion was updated for the refined
focus ring. The Python-related test passed when only the verification process's
PATH was prefixed with the available bundled Python 3.12.14. No OS-level PATH,
browser network policy, or filesystem-edit implementation was changed.

Public search remains environment-dependent; this layout change does not claim
to resolve the previously observed external search-engine connectivity issues.
No release, commit or publication is part of this change.

## Interaction polish follow-up

The follow-up review reproduced and fixed the following interaction defects:

- Floating model menus choose the available side of the composer and fit the
  viewport without covering their trigger. Filtering keeps that placement stable.
  Status refreshes preserve the search query and focus, including a changed model
  catalogue; unchanged catalogues no longer rebuild the open menu.
- Opening Settings, a modal, or another workbench surface closes stale floating
  selects. Tab resumes the triggering control's document order, focus indicators
  remain visible, and the command palette can return to a previously hidden chat.
- A new approval reveals the conversation from focused/narrow workbench layouts,
  preserving the draft and requiring an explicit decision. Refreshing the same
  approval does not repeatedly move focus, and failed decisions remain retryable.
- Provider, model and permission controls reflect the running state immediately,
  close any open menu, and become usable again after completion.

Four real-browser regression scenarios cover these states. The menu scenario
also checks stable filtering during both unchanged and changed status responses.
The running-state fixture keeps the status endpoint consistent with simulated
turn events; an earlier inconsistent fixture reported idle during a running turn.

Visual checks inspected the light 1100×760 browser/chat split and dark 1440×900
conversation. Screenshots are saved in `output/workbench-polish/` as
`model-search-workbench.png` and `model-search-desktop-dark.png`.

Completed checks for this pass:

- `pnpm verify:webui`: 24 files, 267 tests passed; client types, scoped lint/format
  and CLI build passed (`tmp/webui-polish-verify.txt`).
- Four focused Playwright scenarios passed (`tmp/webui-polish-focus.txt`).
- Full `pnpm test`: 263 files passed, 1,893 tests passed and 6 skipped
  (`tmp/webui-polish-vitest.txt`). The available bundled Python was supplied only
  on the verification process's PATH.
- Full `pnpm test:webui:e2e`: 48 passed, 1 opt-in public-network smoke skipped
  (`tmp/webui-polish-e2e.txt`).
- `pnpm build`, `pnpm lint`, and `pnpm verify:architecture` passed
  (`tmp/webui-polish-build.txt`, `tmp/webui-polish-lint.txt`, and
  `tmp/webui-polish-architecture.txt`).
- Global `pnpm format:check` still reports only the unrelated pre-existing
  `docs/design-impasto-validation.md` (`tmp/webui-polish-format.txt`).

`git diff --check` also passed. Approval semantics, browser network restrictions,
authentication and session isolation were not relaxed for these fixes. Public
search-engine connectivity was not revalidated by the skipped opt-in smoke.
