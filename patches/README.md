# Dependency patches

`undici@8.12.4.patch` backports the orphan-stream lifecycle fix proposed in
[Undici PR 6147](https://github.com/nodejs/undici/pull/6147), addressing
[issue 6143](https://github.com/nodejs/undici/issues/6143). The upstream proposal
is not yet released. Undici remains MIT licensed; its notice is included in the
repository and distributed CLI notices.

On Node 26.13.1, an aborted HTTP/2 request can leave a stream without an error
listener. Later idle teardown crashes the process. The patch cancels only these
orphan streams and retains their error listener. It does not intercept process
exceptions or hide request failures.

`Http2Cancellation.test.ts` reproduces the failure in a child process before the
patch and verifies abort, idle teardown, and reconnection after the patch. CLI
startup selects the patched stock dispatcher when Node has already initialized
its bundled one, while retaining explicit host proxy/custom dispatcher classes.

Remove this patch only after updating to a released upstream fix and confirming
the regression and complete release gates pass. Keep the lockfile patch hash
and this file synchronized; never silently edit installed dependencies.

## Playwright test assertions

The published Playwright 1.65.1 test runner embeds six picomatch modules in
`lib/matchers/expect.js`. The version-pinned patch removes those modules and
uses the separately resolved minimatch package in two internal Jest utilities:
ordered glob selection and stack-frame highlighting. The browser driver,
web-first assertions, auto-waiting, retries, tracing, and browser launch
continue to come from Playwright. Review the code and the upstream inventories
on each upgrade. Remove the patch when the released runner ships without this
copy. The original Playwright version remains visible to the registry audit.
