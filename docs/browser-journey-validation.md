# Built-in browser journey and recovery validation

## First-frame canvas and recovery states (2026-09-27)

- The browser canvas now distinguishes its idle, opening, closing,
  waiting-for-first-frame, disconnected, and failed states. When a captured frame exists, it remains
  visible during loading or disconnection instead of being replaced by a
  placeholder. The small loading chip appears only over a retained frame.
- English, Simplified Chinese, and Traditional Chinese browser journeys check
  the opening, closing, disconnected, and failed canvas copy; a real first frame;
  explicit reconnect and retry; preserved chat drafts; and 1100px dark visuals.
  The idle privacy note is hidden outside the idle state. Fixture 503 and 400
  responses are the only expected browser-console errors in these journeys.

## Explicit website download (2026-09-27)

- A website download now appears as a page-bound, two-minute confirmation in
  the WebUI. Orbit retains at most one pending file and 64 MB of file bytes;
  only Save file hands those bytes to the user's browser download flow. The
  website filename is sanitized. No website-supplied path writes into the
  project. Playwright/Chromium may use its own temporary download storage while
  receiving a file; this is not a claim of zero temporary disk use.
- Dismissal, navigation, tab changes, and browser/session close revoke the
  request. The authenticated binary response is single-use, `no-store`, and
  checked against the current session after body parsing. Agent work cannot
  confirm a pending file. Files over 64 MB show a contained error.
- A real Edge journey exposed two platform behaviors: download navigation may
  briefly report an empty frame URL, and Edge opens an internal
  `edge://downloads-hub/` page. The browser now ignores the transient URL and
  does not register internal pages as website tabs. English, Simplified Chinese,
  and Traditional Chinese journeys passed with direct website clicks, save,
  replay rejection, discard, tab invalidation, preserved chat drafts, desktop
  and 1100px dark screenshots, and zero page errors.
- Final regression: 2,004 Vitest tests passed (six existing skips), and the
  complete Playwright suite passed 72 tests (two opt-in public-network skips).
  Workspace ESLint, changed-source strict types, CLI build, architecture,
  documentation links, runtime budgets, targeted formatting, and diff checks
  passed.

## Explicit website file upload (2026-09-27)

- Headless Chromium file chooser events now create a two-minute, page-bound
  capability. The WebUI shows a contained, keyboard-reachable panel and sends
  only files the user chooses and confirms. Single and multiple inputs work,
  including empty files. The authenticated binary route limits each request to
  eight files and 32 MB total; metadata rejects paths and malformed types.
  Uploaded bytes are applied to the website input in memory and are not saved
  as workspace files or exposed through browser polling state.
- Cancel leaves the website's existing file selection alone. Navigation, tab
  changes, dialogs, browser close, and session replacement revoke the request.
  Agent work cannot apply an upload; binary requests require the same WebUI
  authentication and origin checks as other mutations.
- Real installed Edge journeys passed in English, Simplified Chinese, and
  Traditional Chinese, covering explicit confirmation, cancellation, multi-file
  order, draft preservation, desktop/narrow visuals, and zero page errors.
  Focused unit and HTTP-boundary checks cover stale requests and malformed data.
  The final full run passed 1,997 Vitest checks (six existing skips) and 69
  Playwright checks (two opt-in public-network skips). Workspace ESLint,
  production-source types, CLI build, architecture, documentation links, and
  targeted formatting passed. Repository-wide formatting still finds only the
  pre-existing unrelated `docs/design-impasto-validation.md` issue. Downloads
  were not included in that run and are validated separately above.

## Native website picker follow-up (2026-09-27)

- Follow-up: pointer events now carry validated Ctrl/Shift/Alt/Meta modifiers
  into Chromium, allowing visible native multi-select listboxes to preserve
  additive and keyboard range selection. Real Edge checks cover Ctrl-click
  and Shift+Down in all three UI languages. A separate folded multi-select panel is not needed for this
  visible inline control.
- Color now clearly offers the displayed black as an explicit new value, even
  before the color control emits input. Reapplying unchanged black does not
  duplicate website events. Native value assignment also bypasses a
  framework-owned instance tracker; a controlled-date fixture checks that the
  website's input handler receives the new value.
- Chromium's date, time, datetime-local, month, week, and color pickers do not
  appear in its page screencast. The browser now detects only a user-opened
  picker and shows a contained, keyboard-reachable Orbit control. Its current
  website value remains host-side; the WebUI receives a bounded label, type,
  safe constraints, geometry, and a short-lived opaque capability ID.
- Apply validates the live control and its constraints before changing the
  website. Cancel, navigation, tab/viewport changes, dialogs, and session reset
  revoke access. The website receives one input/change pair only when the
  normalized value actually changes. Busy Agent work blocks Apply but still
  allows dismissal.
- Real Edge journeys passed in English, Simplified Chinese, and Traditional
  Chinese. They cover all six input types, out-of-range rejection, optional
  clearing, unchanged-value events, draft preservation, stale capability
  rejection, default desktop and 1100px dark screenshots, and zero page errors.
  Focused native-picker, contract, client, and bridge tests also passed.
- Final validation after the modifier compatibility correction: all 1,996
  Vitest tests and 66 complete Playwright checks passed; two opt-in public
  network checks remained skipped in the deterministic suite. Workspace lint,
  builds, strict changed-file types, architecture, Markdown, and targeted
  formatting passed. The repository-wide format check still identifies only
  the unrelated existing `docs/design-impasto-validation.md` file.
- An opt-in public check loaded TypeScript documentation directly, but could
  not establish search-result click-through here. Bing's resources failed in
  both Orbit and an ordinary browser comparison; DuckDuckGo and Baidu showed
  provider verification pages. This is not evidence of an Orbit-only defect.

At that checkpoint, uploads, downloads, and external search-result click-through
remained separate gaps. Uploads and downloads are validated above; public
search-result click-through remains unverified in this environment.

## Desktop WebUI deep review (2026-09-26)

- Inspected the default desktop, 1100px focused browser, and dark screenshots.
  The browser chrome and controlled website-select panel stayed inside the
  workbench without horizontal clipping. Sidebar metadata at 9–10px remains a
  lower-priority readability refinement; no broad layout change was made here.
- An opened, folded single-choice website selector is now a searchable,
  keyboard-reachable Orbit panel with opaque option IDs. Real Edge checks cover
  three UI languages, grouped and disabled choices, a 213-option list, stale
  capability rejection, same-origin child frames, and unchanged chat drafts.
  Website option values and HTML do not cross into the WebUI.
- A full run exposed one handoff-test race after a backend-direct page open:
  the button briefly became enabled before viewport synchronization settled.
  The journey now waits for the actual browser image/viewport. The unchanged
  handoff flow passed three isolated repeats and both subsequent full runs.
- A disconnected preview previously sent failed frame polls about every 120ms.
  Consecutive failures now back off to at most four seconds; explicit Reconnect
  bypasses the delay. A real-browser regression bounds failed request volume
  while preserving page state, drafts, and automatic recovery.

The final complete Chromium run passed 63 tests with 2 opt-in public-network
checks skipped (`output/webui-review-backoff-final-e2e-20260926/`). The full
Vitest run before the polling-only follow-up passed 1,988 tests; 23 focused
client/style tests, the affected CLI build, workspace ESLint, strict client
and browser-E2E types, architecture and Markdown checks passed afterward.
Targeted formatting passed. Repository-wide formatting still reports only the
unrelated existing `docs/design-impasto-validation.md` file.

At this earlier checkpoint, external search-result click-through was unverified
under the observed network/provider challenges; file uploads and downloads were
unavailable; native date/time/color and multi-select controls had not received
the folded-select treatment. None was counted as a passing browser journey.

## Reading-surface recovery refinement (2026-09-26)

- Waiting for the actual successful navigation response reproduced a second
  recovery issue: retrying the original address overwrote a later unsent address
  draft. The typed recovery helper now retains that independently edited draft,
  including a deliberately emptied field, while Go continues to commit its own
  submitted address. Recovery still sends only the original request/provider.
- Real hit testing reproduced an idle reminder hidden behind the page-outline
  panel. The same reminder now lives inside the reading surface while the outline
  is open and returns to the canvas when closed. It does not cover text/controls,
  change Chromium viewport geometry, or automatically renew the session.
- Keyboard and pointer renewal retain the outline, its settled reading position,
  page ID and address draft. Focus returns to readable text rather than a hidden
  screenshot stage. Real Edge checks cover split reading, the docked outline in an
  expanded workbench, and dark reading at 1100px, in all three UI languages.
- The regression waits for completed requests and settled keyboard scrolling;
  hiding a notice at request start is not evidence of successful recovery.
  Teardown releases the intentionally held resize and drains interception handlers
  before stopping the server, preventing late fixture responses during cleanup.

The final full Vitest run passed 269 files: 1,976 tests passed and 6 skipped.
Focused recovery/client/style coverage passed 35 tests. All workspace builds,
workspace ESLint, client/E2E strict types, architecture and diff checks passed.
Production types passed with the repository's existing filter excluding 214
test-only diagnostics. Global formatting still reports only the unrelated existing
`docs/design-impasto-validation.md`.

The first complete Chromium run passed 59 checks, skipped 2 public-network checks,
and reported a Playwright response-handle failure in the Traditional Chinese
journey; the exact unchanged journey passed on rerun. The fixture's route teardown
was then aligned with the other lifecycle journeys before the final complete run.
The final complete Chromium run passed 60 tests with 2 opt-in public-network checks
skipped (4.4 minutes). Final commands included `vitest run`, `playwright test`,
all workspace package builds through pinned pnpm, workspace ESLint, strict client
and recovery-E2E type checking, and the repository-equivalent production type
filter. The Markdown verifier also passed all 82 working-tree documents and their
local links; every file changed in this follow-up passed targeted Prettier checks.

Inspected screenshots are preserved in `output/browser-recovery/`:
`idle-zh-reader.png`, `idle-zh-reader-docked.png`, `idle-zh-reader-dark.png`, and the
reproduced pre-fix `idle-zh-reader-obscured.png`. Native website popups and the
external search-result click-through remain separate acceptance items, not claims
of completeness from these reading checks.

## Deep-review recovery follow-up (2026-09-26)

- Reproduced the generic Retry defect: a failed page-outline read could submit
  an unsent address draft as a new search/navigation. Recovery now repeats only
  the original submitted address/provider, current-page outline read, selection
  copy or reload. It does not replay uncertain page input, clicks, history,
  dialogs or tab mutations. Changing pages invalidates page-scoped recovery.
- Page-actions menus close on Tab, Shift+Tab and focus leaving the menu. Escape
  dismisses an open menu before hiding the workbench. A prematurely queued
  focusout handler swallowed menu clicks in the first regression run; the final
  focusin handler preserves clicking while closing on an actual focus move.
- The existing 30-minute idle cleanup remains. A last-two-minute reminder uses
  an overlay, not a layout row, so it does not resize Chromium or renew its own
  deadline. Keep open is explicit, does not navigate/reload, preserves tabs and
  drafts, and returns keyboard focus to the page after its control disappears.
- Idle closure records a reason and explains cleared tabs/cookies in all three
  languages. Enter address focuses the preserved draft without submitting it.
  Invalid/stale renewal, input and resize requests are rejected before entering
  the operation lifecycle. They cannot extend idle cleanup or publish a generic
  failure over the idle-close state. Late client errors also retain page/session
  ownership checks.
- Unit fake timers verify the real deadline, passive reads, explicit renewal,
  invalid IDs, pending website dialogs, cleanup and reopening. Three real Edge
  journeys cover read/reload/original-address recovery, no draft submission,
  menu keyboard flow, unchanged stage geometry, explicit non-navigating renewal,
  busy state, drafts, localized cleanup and a controlled late resize failure.
  Screenshots are preserved in `output/browser-recovery/`.

The final complete Chromium suite passed: 60 tests, with 2 opt-in public-network
checks skipped. Stable desktop and 1100px light/dark screenshots were inspected.
With source and tests frozen, the final full Vitest run passed all 269 test files:
1,974 tests passed and 6 were skipped (1,980 total).
Client/E2E types, workspace ESLint, architecture and diff checks passed. Production
TypeScript checking passed using the repository's existing filter (214 test-only
diagnostics were excluded; Vitest remains their execution gate). All workspace
builds passed, followed by a final CLI ESM/declaration rebuild. Repository-wide
Prettier still reports only the existing unrelated
`docs/design-impasto-validation.md`; every changed file is formatted.

The first full Chromium run had three outdated direct-browsing assertions that
used Retry to submit an edited address. Those now use Go for the new explicit
navigation; the original-request recovery assertions remain in the dedicated
journeys. The final six direct-browsing/recovery scenarios passed independently
before the complete rerun. No public search-provider reliability claim or
challenge bypass is part of this follow-up.

## Changes

- A lost frame connection is shown as **Disconnected**, not **Live**. The last
  frame is visibly dimmed and direct page input is paused while disconnected.
- **Reconnect** retries only the authenticated frame request. It does not reopen
  the address, reload the website, or submit the address-bar draft. Superseded
  polls cannot overwrite a newer response, and polling timeouts surface a notice.
- Address-bar edits survive background frames and workbench switches. Escape
  restores the current address; opening or selecting a tab updates it immediately.
- Failed stylesheets/scripts show a bounded, per-tab **Page incomplete** notice
  with an explicit reload action. Cancelled and image requests do not trigger it.
  Navigating or successfully reloading clears the relevant resource-failure state.
- Timeout, DNS, connection, and certificate failures receive concise English,
  Simplified Chinese, and Traditional Chinese explanations. Certificate checks
  remain enabled. Unknown policy errors retain their original first-line message.
- Deferred viewport sizing resumes after browser/Agent activity. This avoids
  leaving a reduced-size page image after the available stage size changes.

The existing search-engine preference, explicit submission rule, browser proxy,
local-service isolation, authentication, and approval boundaries are unchanged.
No automatic search-engine fallback, personal profile reuse, or security bypass
was added.

## Browser evidence

The real WebUI server and installed Edge/Chromium were exercised through
Playwright. Fixtures simulate connection failure and an HTTP 503 stylesheet,
without depending on an external outage.

- Recovery does not send a navigation mutation or add a website visit; the same
  page, unsent page input, chat draft, and address-bar draft remain available.
- The Agent handoff keeps the draft text intact and adds a removable page
  attachment. Browser → Changes → Browser keeps the original page and address
  draft; the page guidance is model-only, not displayed in chat history.
- Resource failures and explicit reload recovery run in all three UI languages,
  with 1440px desktop and 1100px split view, light and dark screenshots.
- Existing direct browser checks cover actual pointer input, Chinese IME, history,
  dialogs, tabs, scrolling, shared Agent access, and close/session cleanup.

Screenshots are saved under `output/browser-journey/`:
`disconnected.png`, `incomplete-zh.png`, and `incomplete-zh-TW.png`.

## Public-network findings

The opt-in search check was run rather than skipped for this review:

1. `example.com` opened successfully. The first Bing search reached the search
   page, but its resources/results were incomplete (`tmp/browser-journey-public.txt`).
2. A subsequent run passed and displayed styled results linking to official
   TypeScript documentation (`tmp/browser-journey-public-final.json`, screenshot
   `output/browser-journey/public-search-loaded.png`).
3. An expanded search → documentation → Agent handoff check failed again at
   search-result loading, before the documentation link could be opened
   (`tmp/browser-journey-public-flow.json`). The new incomplete-page notice was
   visible (`output/browser-journey/public-search-warning.png`).
4. A read-only ordinary-browser comparison using the same public query also
   reported `r.bing.com: net::ERR_CONNECTION_CLOSED` and no documentation result.

This demonstrates intermittent external connectivity, not a completed reliability
acceptance of public search. The complete external search-to-documentation journey
remains unverified; the equivalent local browser/Agent workflow is covered by
deterministic tests. No CAPTCHA, certificate, or network restriction was bypassed.

## Public-network follow-up (2026-09-25)

- Repeated Bing search still reached a partially loaded results page. Orbit
  displayed **Page incomplete**; an ordinary Chromium page loading the same
  search also lacked the documentation result and reported repeated
  `r.bing.com: net::ERR_CONNECTION_CLOSED` requests.
- Explicitly selecting DuckDuckGo through Browser settings reached its search
  page, but the site required an interactive human challenge. The ordinary
  Chromium comparison likewise had no documentation result.
- Explicitly selecting Baidu redirected to `wappass.baidu.com` for a human
  challenge. The ordinary Chromium comparison reached the same verification
  host. The opt-in test now reports the short destination instead of printing
  the long challenge URL, and preserves screenshot and comparison evidence on
  early redirects.
- Opening `https://www.typescriptlang.org/docs/` directly through Orbit passed:
  readable documentation appeared, the unsent question gained a removable
  browser attachment, and switching Browser → Changes → Browser kept the same
  page. This is an independent opt-in test, not a substitute for a successful
  search-result click-through.

The remaining acceptance gap is now isolated to search-provider availability
under this environment. No engine is silently substituted and no site challenge
is bypassed.

## Earlier verification

- `pnpm test`: 264 files, 1,897 tests passed; 6 skipped
  (`tmp/browser-journey-vitest.txt`). The bundled Python runtime was added only to
  the verification process's PATH.
- `pnpm verify:webui`: 25 files, 270 tests passed; client type checking, scoped
  lint/format and CLI build passed (`tmp/browser-journey-verify.txt`).
- `pnpm build`: all workspace package builds passed
  (`tmp/browser-journey-build.txt`), followed by the final CLI build above.
- `pnpm lint` and `pnpm verify:architecture` passed
  (`tmp/browser-journey-lint-final.txt`, `tmp/browser-journey-architecture.txt`).
- `pnpm format:check` reported only the existing unrelated document below
  (`tmp/browser-journey-format.txt`); the new validation record is formatted.
- `pnpm test:webui:e2e`: 52 passed, 1 opt-in public-network smoke skipped
  (`tmp/browser-journey-e2e.txt`). The public smoke was run separately with its
  opt-in flag; its mixed outcomes and ordinary-browser comparison are above.
- `git diff --check` passed.

The existing unrelated formatting issue in `docs/design-impasto-validation.md`
has not been edited as part of this browser change. No release or commit was made.

## Deep review follow-up (2026-09-25)

- A slow public search could commit and display its main document, then time out
  waiting for `DOMContentLoaded`. Orbit previously reported the navigation as a
  failure over that visible page. It now keeps a committed HTTP(S) page usable
  and marks it incomplete; pre-commit timeouts and other navigation errors still
  fail. The resource-error set remains bounded.
- The opt-in public-search test now preserves its original assertion failure
  when the browser is busy during evidence capture, retains a screenshot and
  read-only direct-browser comparison, and allows enough time for the actual
  destination to appear. It does not relax the documentation-result requirement.
- Bing displayed a partially loaded search page but no target result in Orbit or
  ordinary Chromium. DuckDuckGo and Baidu required human challenges. The
  separate opt-in direct TypeScript documentation and Agent handoff passed. A
  public search-result click-through is still not verified in this environment.
- Browser-focused unit tests: 81 passed. Browser E2E: 13 passed, 2 opt-in public
  tests skipped. Full Vitest: 268 files, 1,951 tests passed, 6 skipped. CLI
  production build, relevant lint/format, WebUI-client type check,
  architecture verification, and `git diff --check` passed.

## Navigation consistency follow-up (2026-09-25)

- The same committed-page timeout handling now applies to toolbar Reload and
  Back/Forward, including reloads requested through the Agent browser service.
  A page that has already committed stays usable with the incomplete-page
  notice. A timeout before commit remains a genuine failure.
- Browser runtime/bridge tests: 89 passed. The incomplete-page recovery and
  direct-interaction WebUI journeys passed in English, Simplified Chinese, and
  Traditional Chinese (6 E2E tests). The CLI production build, workspace lint,
  architecture check, targeted formatting, and `git diff --check` passed.
- Workspace-wide Prettier still reports only the unrelated
  `docs/design-impasto-validation.md` file; it was left untouched.
- The final full Vitest rerun passed: 268 files, 1,952 tests passed, 6 skipped.

## In-page find follow-up (2026-09-25)

- Added a compact find overlay inside the browser canvas, with next/previous
  controls, keyboard shortcuts, and a context-menu entry. Opening it does not
  resize the website viewport; a temporary resize keeps the query editable.
- Find requests are bounded, validated, and tied to the current page ID. The
  WebUI bridge rejects results after a session change. Search text is passed as
  a Playwright evaluation argument, not interpolated into executable code.
- A stale find result no longer emits a browser-wide failure status or notice;
  the find control owns that transient feedback. Other browser actions retain
  their existing error reporting.
- Closing the find bar, editing the query, or changing the page view invalidates
  its pending request. A late response cannot unlock or overwrite a newer find.
- The real Chromium find/shortcut journey passed three consecutive runs before
  the final visual synchronization change. That final change scrolls the match
  into view and captures a fresh frame so the visible page matches the “Found”
  status. The pending tests now assert that the WebUI image changes, the matched
  text is selected, and a screenshot from an obsolete page is discarded. The
  corresponding focused Vitest and Chromium reruns were initially delayed when
  the approval service rejected test-process launch because the account hit its
  usage limit. This was not a test failure or a safety determination; current
  rerun results are recorded below.
- Targeted lint, Prettier, WebUI client checking, CLI production-source type
  checking, architecture verification, and `git diff --check` passed after the
  change. The later runtime and visual acceptance checks are recorded below.

## Earlier broader verification (before the final find and state-gate edits)

- `pnpm test:webui:e2e`: 55 passed, 2 opt-in public-network tests skipped.
  The direct public-documentation/Agent-handoff test also passed when enabled
  separately. The search test was run with Bing, DuckDuckGo, and Baidu; none
  completed the search-result click-through under the observed network/site
  conditions, as detailed above.
- `pnpm verify:webui`: 28 files and 302 tests passed, including client type
  checking, scoped lint/format, and CLI build.
- `pnpm test`: 268 files and 1,948 tests passed, 6 skipped. This run used the
  original Windows Python app alias; a separate focused test with a working
  Python interpreter also passed. The accompanying `edit_file` fix avoids
  mistaking an unavailable interpreter for a Python syntax error.
- Full workspace `pnpm build` passed before the `edit_file` change; the affected
  tools and CLI packages were rebuilt successfully afterward. `pnpm lint`,
  `pnpm verify:architecture`, targeted Prettier checks, and `git diff --check`
  passed. Repository-wide `pnpm format:check` still reports only the unrelated
  `docs/design-impasto-validation.md` formatting issue.

## Browser state and accessibility follow-up (2026-09-25)

- A shared interaction guard now pauses navigation, tab changes, direct page
  input, page-outline controls, and mutating menu actions when the live browser
  is busy, a website dialog is open, or the frame connection is lost. Address
  drafts remain editable during a disconnection; Reconnect remains available.
- Tab and reader controls use `aria-disabled` while temporarily unavailable so
  keyboard focus is not discarded. The browser status distinguishes background
  browser work from an Agent turn. A disconnected Ctrl+F directs focus to
  Reconnect instead of opening an unusable search field.
- The focusable page region now references its current title and localized
  keyboard/outline instructions for screen readers. Three-language markup
  assertions and focused browser-flow assertions were added.
- Client and E2E TypeScript checking, targeted ESLint and Prettier,
  architecture verification, and `git diff --check` passed. The updated
  Chromium and Vitest journeys, current desktop/narrow screenshots, and wider
  build/test results are recorded below.

## Current browser acceptance (2026-09-26)

- The full local browser E2E suite passed: 13 tests passed and the two
  opt-in public-network tests were skipped. It covers local-service isolation,
  Agent cancellation and handoff, page find, page outline, disconnected recovery,
  partial-resource recovery, direct input, three UI languages, and stale frames.
- Real desktop, narrow desktop, and dark-theme screenshots were inspected from
  that run. The find result visibly selected the matched text. No obvious
  clipping or horizontal overflow was found in the inspected browser layouts.
- The rendered settings panel exposed a small visual defect: transient toasts
  covered its lower-right copy. The toast region now lifts above the measured
  settings panel while it is open and returns to its normal position on close.
  The latest full browser E2E rerun passed (13 tests, 2 opt-in skips), including
  explicit toast/panel separation on desktop and 1200px narrow layouts in all
  three languages and a reset assertion after the panel closes. A background
  resize and input-queue race found during repeat runs was addressed in the
  E2E synchronization helpers; the find journey also passed three consecutive
  focused runs.
- The post-change WebUI test set passed (28 files, 303 tests). CLI ESM and
  declaration builds, workspace ESLint, targeted Prettier, architecture
  verification, and `git diff --check` passed. The full Vitest run immediately
  before the toast-only change passed (268 files, 1,955 tests, 6 skipped);
  a later full rerun after the navigation/focus work is recorded below.
  Repository-wide Prettier still reports only the unrelated
  `docs/design-impasto-validation.md` file, which was left untouched.
- The public search-result click-through remains unverified under the external
  provider/network conditions documented above. It is not counted as passed.

## Async navigation and keyboard focus follow-up (2026-09-26)

- A real Chromium regression exposed a race between an address update and the
  later page-ID change at navigation commit. If polling observed those changes
  separately, the find bar could remain visible over a different page. The
  WebUI now clears page-scoped overlays and queued direct input when either
  the destination or page ID changes. It does not repeatedly reset an already
  closed browser during idle polling.
- When an Agent or page navigation dismisses the find bar, page-actions menu,
  or page outline, keyboard focus returns to the live page region instead of
  remaining on a hidden element. Explicitly closing the outline still returns
  focus to Page actions.
- The new navigation/focus journey passed five consecutive focused Chromium
  runs. The full local browser suite then passed with 13 tests and two opt-in
  public-network tests skipped. WebUI unit tests passed (28 files, 304 tests),
  and the full Vitest suite passed (268 files, 1,956 tests, 6 skipped).
  Standalone client/E2E type checks, full workspace ESLint, targeted
  Prettier, the CLI ESM/declaration build, architecture verification, and
  `git diff --check` also passed. Repository-wide Prettier still reports only
  the existing unrelated `docs/design-impasto-validation.md` file.

## Disconnected find and recovery presentation (2026-09-26)

- With an open find bar, losing the frame connection previously disabled its
  search field and dropped keyboard focus. The query now remains an editable,
  unsent local draft. Its status says **Reconnect to find**; pressing Enter
  focuses Reconnect and does not issue a browser mutation. Successful polling
  clears that status but does not submit the query. A held find response was
  released after disconnection in the Chromium test; its stale result did not
  overwrite the reconnect guidance.
- The notice's Retry/Reload/Reconnect action now uses the existing secondary
  button treatment, making the recovery path clearer against the warning
  surface. Real Chromium screenshots at 1440px and 1100px desktop widths,
  including the narrow dark theme, were inspected; the find bar and notice
  stay contained without horizontal overflow.
- The full local browser E2E suite passed (13 tests, two opt-in public-network
  tests skipped). WebUI tests passed (28 files, 305 tests). Client/E2E type
  checks, workspace ESLint, CLI ESM/declaration build, architecture check, and
  `git diff --check` passed. The full Vitest suite passed (268 files, 1,957
  tests, 6 skipped). Targeted Prettier passed; repository-wide Prettier still
  reports only the unrelated `docs/design-impasto-validation.md` file.

## Search disclosure and browser-scoped dialog follow-up (2026-09-26)

- The address control now displays the selected search provider before a query
  is submitted. It reflects the saved preference and all three UI languages;
  changing the provider never submits the current address draft.
- Escape closes the browser settings popover and returns focus to its summary
  before it can close the workbench. Website dialogs explicitly remain
  browser-scoped, nonmodal to Orbit: Tab can leave them, and Escape can dismiss
  the pending website dialog before closing the workbench. Browser actions
  remain locked while the website waits for its response.
- The optional Google public-search check reached a provider unusual-traffic
  challenge rather than usable results. Ordinary Chromium also returned no
  documentation result. The search-result click-through therefore remains
  unverified; neither challenge bypass nor automatic provider switching was
  introduced. Its destination assertion now omits query strings from failed
  route output so challenge tokens are not printed there.
- Focused real-Chromium checks passed in English, Simplified Chinese, and
  Traditional Chinese (6 tests). The full local browser suite passed (13 tests,
  2 opt-in public-network tests skipped). Current default, 1100px focused,
  and dark screenshots were inspected without address clipping. WebUI tests
  passed (28 files, 305 tests); the full Vitest run passed (268 files, 1,957
  tests, 6 skipped). Client/E2E type checks, workspace ESLint, affected CLI
  ESM/declaration build, architecture verification, targeted Prettier, and
  `git diff --check` passed.
- Repository-wide Prettier still reports only the unrelated existing
  `docs/design-impasto-validation.md` issue. Repository-wide `pnpm build`
  could not start because the available pnpm 11 attempted a dependency-directory
  purge and aborted in the noninteractive environment; no dependency purge was
  approved or performed. The affected CLI package build passed directly.

## Focused return and ordered direct input (2026-09-26)

- Focused and automatically narrow workbenches now show a localized Back to
  chat action with a back arrow, rather than an ambiguous close icon. It hides
  the workbench and focuses the existing prompt; it does not close Chromium,
  discard tabs, submit the address draft, or reset the split-width preference.
  Split mode retains its icon-only hide action and original focus restoration.
- The first full Chromium run exposed a rapid hover-to-wheel failure: no wheel
  batch reached the browser. Polling could observe the client's own input batch
  as busy and block the next direct-input event. Direct input now distinguishes
  its own serialized transport from external work. Input-batch epochs reject
  late polling state before/after a batch while polling continues during input
  so a website dialog remains visible and answerable. Agent activity, navigation,
  dialogs, disconnects, page changes, and session changes retain their guards.
- Three-language E2E journeys hold a hover response and simulate its busy poll,
  then assert that a queued wheel is delivered. They also cover website dialogs,
  keyboard return, preserved tabs and address/chat drafts, and stable 1100px
  viewport screenshots. These journeys passed twice each (6 focused runs).
  The final complete Chromium suite passed (57 tests, 2 opt-in public-network
  tests skipped). Stable light and dark narrow screenshots were inspected;
  horizontal overflow was not found in the measured states.
- Full workspace builds passed using the already-cached project-pinned pnpm
  10.34.5 directly. This resolves the earlier build-launch limitation without
  dependency reinstallation or purging. Client/E2E TypeScript checking,
  workspace ESLint, architecture verification, and `git diff --check` passed.
  The full Vitest suite passed (268 files, 1,959 tests, 6 skipped).
  Repository-wide Prettier still reports only the unrelated existing
  `docs/design-impasto-validation.md` issue.
