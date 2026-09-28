# Orbit Web UI runtime

This directory owns the loopback Web UI launched by the interactive `/webui`
command. Keep browser code here so terminal orchestration in the parent
`runtime/` directory does not accumulate presentation details.

## File map

| Area                  | Files                                                                                                                                          | Responsibility                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Public surface        | `index.ts`                                                                                                                                     | Stable imports used by the terminal runtime.                                                                              |
| Process facade        | `WebUiServer.ts`                                                                                                                               | Public start/stop/argument API and current-instance pointer.                                                              |
| Server lifecycle      | `WebUiRuntime.ts`                                                                                                                              | Per-instance HTTP routing, authentication, turns, and shutdown.                                                           |
| Event stream          | `WebUiEventStream.ts`                                                                                                                          | Per-instance SSE clients, heartbeat, and event-bus bridge.                                                                |
| Server contracts      | `WebUiContracts.ts`                                                                                                                            | Shared loop, settings, handle, and active-turn types.                                                                     |
| Browser-safe data     | `WebUiData.ts`                                                                                                                                 | Status, settings, and message serialization.                                                                              |
| HTTP boundary         | `WebUiHttp.ts`                                                                                                                                 | Response headers, bootstrap cookie, and bounded JSON bodies.                                                              |
| Security boundary     | `WebUiSecurity.ts`                                                                                                                             | Authentication, event allowlisting, and redaction.                                                                        |
| HTML shell            | `WebUiPage.ts`                                                                                                                                 | Localized semantic markup and copy.                                                                                       |
| Client assembly       | `WebUiClient.ts`                                                                                                                               | Ordered composition of the browser script fragments.                                                                      |
| Client implementation | `WebUiClientFoundation.ts`, `WebUiClientInspector.ts`, `WebUiClientMessages.ts`, `WebUiClientMissionControl.ts`, `WebUiClientSlashCommands.ts` | Shared state, inspector lifecycle, message/stream rendering, task and child-agent controls, and composer slash discovery. |
| Client orchestration  | `WebUiClientSession.ts`, `WebUiClientBindings.ts`                                                                                              | API/SSE lifecycle, events, shortcuts, and initialization.                                                                 |
| Style assembly        | `WebUiStyles.ts`                                                                                                                               | Ordered composition of the CSS fragments.                                                                                 |
| Style implementation  | `styles/*.ts`                                                                                                                                  | Foundation, shell, conversation, composer, inspector, feedback, and responsive rules.                                     |
| Regression tests      | `*.test.ts`                                                                                                                                    | Assembly order, syntax, API, lifecycle, data, and security.                                                               |

## Change boundaries

- Browser-facing inputs belong behind strict Zod schemas in `WebUiRequestSchemas.ts`,
  consumed by `WebUiRuntime.ts`.
- `WebUiClientEventRouting.ts` owns the typed, pure session/turn event filter.
  Its browser fragment must remain self-contained: do not introduce server imports
  or closure dependencies into the serialized function.
- Scoped event envelopes retain producer identity through `WebUiEventStream.ts`;
  events from a different session cannot be relabeled as the active chat.
- Keep `WebUiClient.ts` and `WebUiStyles.ts` as composition-only entrypoints;
  add behavior or CSS to the focused fragment that owns it.
- `WebUiClientWorkbench.ts` and `styles/WebUiWorkbenchStyles.ts` own the shared
  nonmodal Browser / Changes / Run workspace: tab selection, focus/split mode,
  temporary navigation collapse and keyboard/pointer resizing. Hidden panels
  retain their DOM and scroll positions. Focused/narrow mode labels its hide
  action Back to chat and returns keyboard focus to the preserved draft;
  split mode retains the original launcher-focus restoration.
  Settings remain an independent modal;
  `WebUiClientInspector.ts` owns its focus containment and the run subtabs.
  Model/provider controls live with the composer, and navigation stays project-focused.
- `WebUiBrowserPreview.ts`, `WebUiClientBrowserPreview.ts`, and
  `styles/WebUiBrowserPreviewStyles.ts` own the live browser surface and transport.
  `WebUiBrowserFeedback.ts` owns concise, localized navigation failure copy.
  `WebUiBrowserRecovery.ts` restricts Retry to repeatable, page-scoped actions
  or the originally submitted address/provider. An unsent address draft is never
  a recovery request or overwritten by a successful original-address retry.
  Uncertain page input, clicks, history, dialogs and tab actions are not replayed.
  Menu Tab/Shift+Tab exits into the browser chrome;
  moving focus outside dismisses the menu without swallowing menu clicks.
  Idle reminders appear only in the last two minutes, as an overlay that does
  not resize the website. While a page outline is open, the same reminder lives
  inside its reading surface so it stays exposed without covering controls.
  Keep open restores focus to the reading text and preserves its scroll position,
  or returns to the page when the outline is closed. It explicitly renews the same
  temporary session without navigation or reload. Closed idle sessions explain that tabs and
  cookies were cleared; Enter address only focuses the preserved omnibox draft.
  Stale renewal, input and resize requests must not renew a deadline or overwrite
  the idle-close reason. Late client errors remain scoped to their page/session.
  `WebUiBrowserPreviewLayout.ts` shares pure split/fit geometry with tests.
  The dock stays inside the workspace's modal/inert boundary. Preserve chat
  drafts, keyboard resizing, and the distinction between hiding and closing.
  `WebUiClientBrowserInput.ts` owns batched pointer, keyboard and IME input.
  Direct input must not block its own next event when a busy frame poll arrives.
  Direct pointer input carries the bounded Chromium modifier bitmask so inline
  website multi-select listboxes can use Ctrl/Shift selection without exposing
  website DOM or adding a separate privileged selection API.
  Shift+Up/Down keys retain range selection for keyboard users.
  Input-batch epochs discard stale polling state while continuing to poll for
  website dialogs; external Agent work, navigation, dialogs, and disconnects
  retain their interaction guards.
  `../browser/BrowserNativeSelect.ts` and `WebUiClientBrowserSelect.ts` adapt
  an opened, folded, single-choice website selector into a contained searchable
  panel. The client receives bounded display labels and opaque option IDs, never
  website HTML, option values, or selectors. The short-lived control reference
  is revoked on page, tab, viewport, session, and direct-input changes. Oversized
  or unsupported selectors fall back to the focused page control's arrow keys.
  `../browser/BrowserNativePicker.ts` and `WebUiClientBrowserPicker.ts` handle
  opened date, time, datetime-local, month, week, and color pickers that Chromium
  omits from the page screencast. The authenticated UI receives only a bounded
  label, type, safe constraints, bounds, and an opaque capability ID; the current
  website value stays host-side. Applying rechecks the live element and emits
  website input/change only when its value actually changes. Cancel, page/tab
  replacement, resize, and session reset revoke the capability.
  A new color defaults explicitly to black and can be applied without a
  synthetic dirty event; the website's current color remains private. Use the
  native input value setter before dispatching events so controlled forms can
  observe the change.
  Discard frames and queued input after stop, page replacement or session changes;
  a pending frame request must never block session-change cleanup.
  A disconnected frame pauses page input but keeps an open find query editable;
  Enter points to Reconnect without sending a page action. Successful polling
  clears the disconnected find status without submitting the query. Failed
  polls back off to a four-second ceiling; explicit Reconnect bypasses the
  delay, and a successful poll or session change resets it.
  `WebUiBrowserPreviewBridge.ts` attaches the host-owned service to the agent,
  rejects stale requests, and handles authenticated API calls.
  The page-actions menu can request a redacted, bounded text outline of the
  current page for keyboard and screen-reader use. Keep it on-demand, scoped
  to the current page and session, and out of chat history and frame polling.
  Its control list uses short-lived element references, never client-supplied
  selectors; navigation, resize, and direct page input revoke them. Activating a link or button
  operates the real page, while focusing a field returns to the direct-input
  channel. A wide expanded workbench docks the outline beside a scrollable,
  readable page frame without resizing Chromium or changing its page ID; smaller docks keep
  the contained overlay.
  Viewport synchronization stays deferred while the outline is open or the
  direct-input sink has focus; closing the outline or leaving page input resumes
  it without unexpectedly replacing the page during a layout transition.
  While a website dialog is open, suspend navigation, tabs, page actions, and
  Agent handoff; keep Close browser available and return focus to the triggering
  control when the dialog resolves. The dialog is scoped to the browser, not
  modal to all of Orbit: keyboard users can leave it, and Escape dismisses it
  before closing the workbench. Do not let deferred resize interrupt it.
  `../browser/BrowserSnapshotRedaction.ts` removes
  editable values from both user and Agent text snapshots; the separately
  extracted control list retains safe labels.
  `WebUiBrowserHandoff.ts` scopes one chat turn to the attached tab and page URL,
  marks the turn for model-only browser context, and releases the pin after
  the first Agent run (before queued follow-ups) or on failure.
  The composer displays a removable attachment without changing the draft.
  `../browser/BrowserLiveSession.ts` owns isolated Chromium pages and CDP streaming.
  It reports failed stylesheet/script resources per tab so incomplete pages have
  an explicit reload path without treating aborted navigation as a page failure.
  Incomplete search recovery keeps the query as an address-bar draft. Choosing
  another engine moves focus to Go, but never submits the query automatically.
  The active search provider stays visible beside the address draft, including
  a provider loaded from local preference. Escape closes browser settings
  before it can close the workbench.
  `WebUiBrowserSearch.ts` recognizes bounded queries only on known search-result
  URLs, including common regional/low-bandwidth variants; unrelated `q` fields
  do not turn a page into a search recovery prompt.
  `BrowserLiveContracts.ts` validates the omnibox and bounded direct-input actions.
  `BrowserNetworkProxy.ts` pins public DNS results and checks one-use local request
  grants; local WebSocket CONNECT requires a validated same-origin handshake.
  An explicitly opened local service may load a same-origin child frame, but
  other local origins and ports remain blocked even from that page.
  The legacy snapshot path retains its stricter single-origin policy.
  Never render website HTML in the authenticated WebUI or let the Agent grant
  itself access to local services. Keep browser startup lazy and preserve normal
  tool permission checks, cancellation, and session cleanup. Snapshots shown to
  users are not automatically supplied to the model as image content.
- `WebUiWorkflowForm.ts`, `WebUiClientWorkflow.ts`, and
  `styles/WebUiCapabilitiesStyles.ts` own workflow authoring and capability
  presentation. Browser stage validation provides localized feedback; the
  server's `WorkflowStagesSchema` remains authoritative. Keep their accepted
  inputs aligned through `WebUiClientWorkflow.test.ts`.
- `WebUiWorkflowDependencies.ts` checks the complete Skill registry, independently
  of the bounded display catalog. Dependency state in the UI is advisory; runtime
  preflight remains authoritative. Preserve undisplayed disabled Skills when saving
  toggles, and serialize Skill settings to avoid stale catalog writes.
- One-click Skill prompts retain explicit invocation. Draft policies never become
  actionable through the UI, and activation feedback identifies truncated resources
  using the active `skill://` namespace.
- Keep browser-safe serialization in `WebUiData.ts` and authentication or
  redaction in `WebUiSecurity.ts`; route handlers should only orchestrate them.
- Runtime instances are single-use. Never move token, turn, SSE client, or
  event-bridge state back to module globals; late work from a stopped instance
  must remain unable to affect its replacement.
- Never expose the launch token, provider credentials, tool arguments, raw tool
  results, internal context messages, stack traces, or credential-bearing URLs.
- Keep the server bound to `127.0.0.1`; retain host/origin checks, strict CSP,
  the HttpOnly bootstrap cookie, request limits, and the SSE client cap.
- A turn must finish in exactly one state: `completed`, `failed`, or `aborted`.
- Terminal and browser turns share `../RunCoordinator.ts`, wired through
  `../CommandRouter.ts`; do not create a second execution path around it.
- Update Chinese and English copy together. Closed mobile drawers and the
  inspector must remain inert and keyboard-safe.

## Focused verification

From the repository root:

```bash
pnpm test:webui
pnpm verify:webui
```

Run `pnpm verify` before handing off changes that affect the agent loop,
configuration, provider events, session history, or packaging.
