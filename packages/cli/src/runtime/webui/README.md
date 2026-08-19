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

- Browser-facing inputs belong behind strict Zod schemas in `WebUiServer.ts`.
- Keep `WebUiClient.ts` and `WebUiStyles.ts` as composition-only entrypoints;
  add behavior or CSS to the focused fragment that owns it.
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
