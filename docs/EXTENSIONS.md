# Orbit extension manifests

Orbit validates extension contracts independently from installation. Validation
does not execute or install the extension:

```powershell
orbit extension .orbit/extensions/review/orbit.extension.yaml
orbit extension .orbit/extensions/review/orbit.extension.yaml --json
```

Install only a manifest you have reviewed. Contributions requesting process,
network, credentials, write access, hooks, or MCP require explicit trust:

```powershell
orbit extension-install .orbit/extensions/review/orbit.extension.yaml
orbit extension-install .orbit/extensions/review/orbit.extension.yaml --trust
orbit extension-list
orbit extension-remove com.example.review
```

Installation copies bounded, non-symlinked files into `~/.orbit/extensions`,
records a SHA-256 digest, and transactionally materializes prompt commands,
skills, and declarative Agent Profiles under Orbit-owned user directories.
Agent Profiles remain isolated under
`~/.orbit/agents/extensions/<extension-id>`; direct user profiles keep
precedence, discovery never follows links or nested profile directories, and
the normal profile permission/isolation checks still apply. At startup,
trusted MCP contributions are loaded
only when the installed digest and manifest ID still match. Tampered entries
are ignored. Removal deletes only the matching Orbit-managed extension path.

The version 1 manifest declares an extension ID and version, compatible Orbit
versions, contribution paths, and requested permissions. Supported contribution
metadata covers commands, skills, agents, tools, lifecycle hooks, MCP servers,
and templates. All paths must remain inside the extension.

Manifests may name credential environment variables but cannot embed common
credential headers. An HTTP MCP server must declare its exact destination host;
a stdio MCP server must request process permission. Lifecycle hooks likewise
must request process permission; Orbit never forwards extension credentials to
hooks and currently denies their network access.

## Sandboxed extension tools

`contributes.tools` is an executable surface, not decorative metadata. Each
tool contribution must point to a bounded YAML/JSON definition whose
`schemaVersion` is `1`, whose `runtime` is `node`, and whose `entrypoint` is an
in-tree `.js`, `.mjs`, or `.cjs` file. The definition contains a strict,
closed-object input schema, a timeout, and an output byte limit. The entrypoint
receives exactly one JSON request on stdin:

```json
{
  "protocol": "orbit-extension-tool-input-v1",
  "tool": { "id": "com.example.local", "name": "summarize" },
  "input": {},
  "context": { "cwd": "<workspace>", "sessionId": "<opaque id>" }
}
```

It must return one JSON object on stdout with
`protocol: "orbit-extension-tool-result-v1"`, `ok`, and optional `data`,
`display`, or `error`; stdout is never treated as an unstructured shell log.
Orbit invokes the fixed Node executable with an argv array, a minimal
sanitized environment, required native process sandbox, read-only extension
root, and only the manifest-declared workspace roots. Network is denied for
this protocol; a contribution with `risk: network` is rejected at install time
and remote capabilities should use a governed MCP server instead. The normal
tool permission approval, audit, timeout, cancellation, output bounds, secret
redaction, and process-tree cleanup paths remain in force. A Windows host
without a verified signed AppContainer helper fails closed.

Administrators can set `disableExtensionTools: true` in managed policy. The
policy is applied before extension trust roots and allow-lists are evaluated,
and again before the final configuration is exposed to the Agent runtime.

Manifest validation is intentionally separate from trust. A valid manifest is
not automatically safe. Orbit activates prompt commands, skills, declarative
Agent Profiles, trusted MCP definitions, and explicitly trusted lifecycle
hooks. Extension hooks are materialized only after the installed tree digest
and manifest ID match; each hook is tagged with its extension provenance and
passes the normal permission/audit path. It then runs in a required native
process sandbox with the extension directory as a read-only working root,
network denied, a minimal environment, bounded output, timeout, cancellation,
and process-tree cleanup. On platforms without a native backend (currently
Windows), the hook fails closed instead of silently running on the host.
Administrators can set `disableExtensionHooks: true` or
`disableExtensionTools: true` in the managed policy.
They can also set `allowedExtensions` to an explicit list of extension IDs;
when the field is present, every other installed extension is rejected before
any MCP, Skill, command, profile, or hook contribution is materialized. The
allow-list is part of the signed policy payload when policy bundles are used.
Orbit never imports arbitrary extension JavaScript into its own process; only
the versioned subprocess protocol above can execute a trusted tool.
