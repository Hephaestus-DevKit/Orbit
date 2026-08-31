# Orbit Windows AppContainer helper

This directory contains the native helper used by Orbit's optional
`windows-appcontainer-helper` process-sandbox backend. It is intentionally
source-only in the repository: a release owner must compile it with the
supported Windows toolchain, review the binary, calculate its SHA-256 digest,
sign the Orbit helper contract, and distribute it through the administrator's
managed installation channel.

Build on Windows:

```powershell
cmake -S native/windows-appcontainer-helper -B build/windows-appcontainer-helper -A x64
cmake --build build/windows-appcontainer-helper --config Release
ctest --test-dir build/windows-appcontainer-helper --build-config Release --output-on-failure
```

The CTest contract gate includes malformed protocol, missing-command, and
relative-executable rejection cases plus a real AppContainer launch with
disjoint read-only and writable roots. It proves the compiled helper can apply
its protocol and cleanly return a child exit code on the Windows runner; it
does not claim that the runner has installed or trusted that artifact for
production use.

The helper accepts only the structured argv emitted by
`packages/sandbox/src/ProcessSandbox.ts`:

```text
--orbit-sandbox-protocol 1
--cwd <absolute-directory>
--network inherit|deny|allow
--read-only <absolute-directory>  # repeatable
--writable <absolute-directory>   # repeatable
-- <executable> <argv...>
```

It creates a per-run AppContainer identity, grants that identity inherited
access only to the declared roots, starts the command with a kill-on-close Job
Object, and restores the original ACLs after the process tree exits. `deny`
does not add network capabilities; `allow`/`inherit` add the Windows Internet
Client capability. The helper never parses a shell command string.

The launch path uses the documented `STARTUPINFOEX` security-capabilities
attribute rather than treating a token handle alone as proof of AppContainer
isolation. Review the corresponding [Microsoft AppContainer launch
guidance](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)
against the compiled binary before signing it.

Orbit does not automatically download, trust, or sign this binary. The
administrator must still configure the path, digest, signature, key id, and
trust root described in [HARNESS_AUDIT_1.6.md](../../docs/HARNESS_AUDIT_1.6.md).
