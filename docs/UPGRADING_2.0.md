# Upgrading to Orbit 2.0

Install a current patched Node.js 24 or 26 release, then update the CLI:

```sh
npm install -g @orbit-build/cli@2.0.0
orbit --version
orbit doctor --json --strict
```

Exit older Orbit processes before reopening `orbit`. Existing configuration,
sessions, and OS credential storage remain in place. No API key needs to be
copied into a configuration file. `/webui` starts the local WebUI and opens its
address in the browser.

## Behavior changes

- Planner, writer, and reviewer requests draw from one run budget, while each
  child also retains its allocation. Enabled DeepSeek Search/Fetch requests
  reserve their known fee before execution. Budget state is saved before a paid
  request starts; a persistence failure prevents dispatch.
- Interrupted or disconnected requests may have incurred a provider charge.
  Their pending reservation survives session restoration until usage is known;
  Orbit does not silently grant that amount again. Unknown prices are reported
  as incomplete estimates. Local estimates are not a provider-side spending cap.
- Extension tools require a working native process sandbox and Node.js 24+.
  Their Node process cannot normally spawn children, workers, or native addons,
  and receives only its declared filesystem roots. Node's permission model is a
  second restriction, not a replacement for native isolation against malicious
  code. External MCP servers and trusted host tools retain their own authority.
- If interactive edit review fails, Orbit rejects the change using that edit's
  checkpoint. It refuses automatic rollback if the file changed during review.
  Partial hunk acceptance is followed by file verification. Those checks do not
  rewrite accepted files; formatting and lint repairs use ordinary reviewed tools.
- Zod 4 replaces Zod 3 in exported package schemas. Extension authors importing
  those schemas should update integrations to Zod 4. The extension manifest
  and existing Orbit configuration formats are unchanged.

## Recovery and validation

Pending child sessions cannot be reattached to a new shared budget: restore the
owning run ledger before scheduling fresh children. Automatic multi-agent crash
resumption is not provided by this release. Interrupted tool calls receive an
explicit recovery result and are not automatically replayed.

The offline acceptance catalog is deterministic and exercises the real agent
loop. It includes malformed arguments, missing files, concurrent reads, and a
26-turn history/recovery scenario. It measures harness behavior, not the model's
success rate on real coding tasks. The separate opt-in DeepSeek smoke suite
checks live API compatibility with synthetic inputs.

For development, follow [the maintainer guide](MAINTAINER_GUIDE.md). Architecture
ownership and guarantees are recorded in [the architecture map](ARCHITECTURE.md).
Release verification remains `pnpm verify:release`; dependency security and native
Windows helper checks remain part of the release workflow.
