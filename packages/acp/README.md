# @orbit-build/acp

Stable ACP v1 client bridge for running external coding agents as separately
owned processes. The bridge keeps external-agent authentication, provider,
model, and native configuration separate from Orbit's provider configuration.

It validates configuration at the boundary, uses an absolute workspace root,
sanitizes the child environment by default, negotiates protocol capabilities,
streams typed session updates, supports cancellation, and preserves bounded,
redacted diagnostics. Durable sessions can be discovered, continued through
capability-driven `session/resume` or `session/load`, and explicitly closed.
History replay is counted separately from the current turn, and all control
operations share the same bounded negotiation, timeout, stderr, and child
process cleanup lifecycle.

Local discovery is available through `loadAcpRegistry()` and the CLI commands
`orbit acp registry list|validate`. User manifests live at
`~/.orbit/acp/registry.json`; project manifests live at
`.orbit/acp/registry.json` and override user entries by id. Manifests are
bounded, schema-validated, reject symlinks, expose a SHA-256 digest, and carry
an explicit `trusted`/`untrusted` state. Discovery never spawns a command and
never turns an entry into an executable configuration unless the caller invokes
`toTrustedExternalAgentConfig()` for an explicitly trusted entry.

Registry distributors may attach an Ed25519 signature:

```json
{
  "schemaVersion": 1,
  "agents": [],
  "signature": {
    "algorithm": "ed25519",
    "keyId": "release",
    "value": "BASE64_SIGNATURE"
  }
}
```

Call `buildAcpRegistrySignaturePayload()` on the schema-parsed unsigned file and
sign its UTF-8 `payload`; configure the matching PEM public key under
`security.acpRegistryTrustRoots.<keyId>`. `loadAcpRegistry()` reports
`unsigned|valid|untrusted-key|invalid`, rejects a present invalid signature,
and can require a valid signature for every discovered registry. Signature
provenance and entry-level execution trust remain independent controls.

Hosted distribution uses `fetchAcpRegistry()` or the explicit command
`orbit acp registry fetch --url https://...`. Hosted documents must carry
`metadata.registryId`, `metadata.owner`, a monotonic numeric `revision`, and
bounded `issuedAt`/`expiresAt` timestamps. The client rejects HTTP, URL
userinfo/fragments, redirects, oversized/invalid bodies, stale/future documents,
owner or registry-id mismatches, invalid signatures, and signature-less files by
default. It supports bounded timeouts, cancellation, `If-None-Match`/304
validation, and caller-owned cache state. The CLI pins only a verified document
inside the workspace with an atomic write and refuses a newer-local-to-older-
remote rollback unless `--force` is explicit. Fetching never starts an agent or
turns entries into executable trust automatically.
