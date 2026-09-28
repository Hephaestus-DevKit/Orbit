# Built-in browser validation

## Scope

The earlier snapshot-only preview has been superseded by an interactive desktop
browser. Real isolated Chromium pages stream through CDP; website HTML never enters
Orbit's authenticated document. The UI supports URLs and user-selected search, pointer and
wheel input, text/IME input, back/forward, reload, tabs, website dialogs,
find-in-page, on-demand text outlines, remote-selection clipboard copy, and shared
Agent access under the existing tool permissions.

The desktop dock follows Orbit's existing visual tokens and preserves the chat
draft. It resizes the website viewport, offers split/focus modes, and distinguishes
hiding from closing. Session changes clear the address/frame immediately, even when
a frame request is pending. The user must explicitly open local services; no personal
browser profile, automatic engine download, or development-server startup is used.
Search defaults to Bing; Google, Baidu and DuckDuckGo can be selected in
**Browser settings & privacy**. Only the engine preference is saved, not queries.
Changing it does not navigate or send a query. No automatic cross-provider retry occurs.

Not Chrome feature parity: downloads, file uploads, extensions, audio, service workers,
local HTTPS and IPv6-only development servers are not supported. The streamed page
itself is not a screen-reader DOM. Browser chrome is keyboard reachable and labelled;
an explicitly requested text outline offers bounded reading and visible control
actions without embedding website HTML. It is not a replacement for the full page DOM.

Current recovery and reading validation is recorded in
[browser-journey-validation.md](browser-journey-validation.md); the dated record
below describes the initial browser implementation, not the latest test totals.

## Security and lifecycle

- Existing WebUI authentication, same-origin checks, body limits and restrictive CSP
  apply to both frames and input. Page IDs reject stale input; polling revisions avoid
  retransmitting unchanged frames. No arbitrary evaluation endpoint exists.
- Public HTTP(S)/WebSocket connections use a bounded authenticated proxy. DNS results
  are checked and the actual TCP connection is pinned to an approved address. TLS
  remains end-to-end; certificates are not ignored.
- Explicitly opened IPv4 loopback HTTP origins receive tab-scoped access. Local HTTP
  requests require one-use URL/method tickets; redirect renewal stays on that origin.
  Chromium's local WebSocket CONNECT path validates its inner same-origin handshake
  before dialing; it is not an arbitrary local TCP tunnel.
- Other private/reserved targets, aliases resolving to private addresses, privileged
  loopback ports and Orbit's control port stay blocked. Public tabs cannot reuse
  another tab's local authorization.
- Dual-stack proxy Fake-IP addresses need independent public DNS verification. Literal
  benchmark IPs and mixed private/synthetic DNS answers remain blocked. IPv6 benchmark
  allocation: [IANA special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry).
- Proxy access is revoked before Chromium cleanup. Epoch guards suppress late launches,
  frames and events. Idle sessions close after 30 minutes; session replacement,
  cancellation during a tool action and WebUI shutdown also reset the browser.
- These controls are not an OS sandbox and cannot restrict requests made by a local
  server itself. Page data may be private; asking the Agent to inspect it shares its
  text evidence. Website text remains untrusted data, not instructions.

## Validation record

Checks run on Windows using installed Edge on 2026-09-21. In commands below,
`pnpm` means `node C:/Users/Admin/AppData/Local/node/corepack/v1/pnpm/10.34.5/bin/pnpm.cjs`.
The bundled Python directory was prepended to PATH for the full Vitest run.
Results before the final source freeze are not substitutes for the final gates.

| Command                                                                                         | Final result                                                                                | Evidence                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------- |
| `pnpm build`                                                                                    | Passed, all 15 workspace packages                                                           | `tmp/browser-live-build-final.txt`      |
| `pnpm lint`                                                                                     | Passed                                                                                      | `tmp/browser-live-lint-final.txt`       |
| `pnpm typecheck:webui-client`                                                                   | Passed                                                                                      | Command output                          |
| `pnpm -r --no-bail --workspace-concurrency=4 exec tsc --noEmit --pretty false -p tsconfig.json` | Exit 1: 207 existing test-only diagnostics; zero production diagnostics                     | `tmp/browser-live-typecheck-final.txt`  |
| `vitest run --reporter=default --reporter=json --outputFile=tmp/browser-live-vitest-final.json` | 260 files passed; 1,881 tests passed, 6 skipped                                             | `tmp/browser-live-vitest-final.txt`     |
| `ORBIT_BROWSER_PUBLIC_SMOKE=1 playwright test`                                                  | 44 passed; 1 failed: strict public Bing search (external resource/network limitation below) | `tmp/browser-live-playwright-final.txt` |
| Focused Prettier check of browser source, E2E and READMEs                                       | Passed                                                                                      | Command output                          |
| `node scripts/verify-architecture.mjs`                                                          | Passed                                                                                      | Command output                          |
| `node scripts/verify-workspace-dependencies.mjs`                                                | Passed                                                                                      | Command output                          |
| `pnpm format:check`                                                                             | Exit 1: only the existing unrelated `docs/design-impasto-validation.md`; browser files pass | `tmp/browser-live-format-final.txt`     |
| `node scripts/smoke-cli.mjs`                                                                    | Passed: startup, config redaction, doctor, init, REPL, exec and LSP                         | `tmp/browser-live-smoke-final.txt`      |
| `node scripts/verify-documentation.mjs`                                                         | Passed, 80 working-tree Markdown files and local links                                      | Command output                          |
| `node scripts/verify-cli-package.mjs`                                                           | Passed: 36 files, 2,626,656 packed bytes, 14,525,217 unpacked bytes                         | Command output                          |
| `git diff --check`                                                                              | Passed                                                                                      | Command output                          |

Functional browser coverage includes:

- Real authenticated WebUI in English, simplified and traditional Chinese: direct
  clicks, Chinese text and IME composition without duplicates, links, history,
  website prompts, tabs (including arrow-key selection), scrolling and close.
- Divider keyboard resizing, focus/split modes, preserved chat drafts and
  locale-aware error feedback. The search preference survives reload and sends
  a query only after explicit submission to the selected provider.
- Local redirect and WebSocket hot reload, with private/control-port leak count zero.
- Delayed POST responses after stop and pending GET frames across session replacement.
  Old requests are aborted or ignored without repainting the previous page.
- Agent-shared fill, click and text evidence against the same Chromium page. This
  tests the service/tool integration, not a live model/provider response.
- Real desktop screenshots at 1440 × 1000 and 1100 × 760, light/dark themes,
  empty/live states and browser settings. No WebUI page errors in the passing flows.

Inspected captures retained outside the replaceable test-results directory:
[desktop split](../output/browser-live-final/browser-zh-live.png),
[narrow desktop](../output/browser-live-final/browser-zh-narrow.png),
[dark theme](../output/browser-live-final/browser-zh-dark.png), and
[search settings](../output/browser-live-final/browser-zh-settings.png).

### Public-search limitation found by visual inspection

HTTPS example.com loads in the actual UI. However, the original smoke test only
checked the search URL and title and reported success while the Bing screenshot
was partially unstyled. That result is **not** evidence of usable public search.
The test now requires actual TypeScript search-result text and retains evidence
on failure instead of accepting a title-only success.

On this host, Bing's `r.bing.com` styles fail with `ERR_CONNECTION_CLOSED` both
through Orbit's pinned proxy and in a fresh Chromium session without it. The
stricter search check fails. Separate public-only diagnostic checks found Baidu
and DuckDuckGo showing human-verification challenges, and Google timing out.
No challenge was solved or bypassed; no private-network policy was relaxed.
This is an unresolved external network/service limitation, not a passing gate.

The UI now provides explicit engine selection and localized actionable timeout
feedback. It does not silently send the same query to other providers.
Diagnostic logs: `tmp/browser-network-diagnostic.txt`,
`tmp/browser-search-providers.txt`, and `tmp/browser-public-verified.txt`.
No personal credentials or private page content were used.
