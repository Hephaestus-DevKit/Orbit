# Release gates

## Read-only preflight

```powershell
git status --short
git branch --show-current
git remote -v
git tag --list
node --version
pnpm --version
```

Confirm the root and publishable package versions agree with CLI version reporting.

## Engineering gate

```powershell
pnpm install --frozen-lockfile
pnpm verify:release
orbit doctor --json --strict
```

Inspect the generated tarball and checksum. Credentialed provider probes require a dedicated low-privilege account and must never print or archive its credentials.

## Authority boundary

The following are external mutations and require explicit authorization for the exact target:

- Commit or push
- Create or move a tag
- Create a GitHub release
- Publish or deprecate an npm version
- Change release-channel dist-tags

Never overwrite an existing immutable release to make local state match it. Increment the version or stop for direction.

## Post-publish

Verify the GitHub tag/release commit, npm version, dist-tag, provenance, tarball checksum, and installation smoke test all refer to the same artifact. Record a rollback that uses a new fixed version or dist-tag change rather than deleting history.
