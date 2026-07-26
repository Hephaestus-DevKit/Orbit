---
name: orbit-release-readiness
description: Prepare and audit an Orbit GitHub and npm release, including version consistency, release verification, package contents, provenance, changelog evidence, and rollback readiness. Use for release、发版、版本号、npm publish、GitHub tag、同步 GitHub/npm or determining whether an Orbit version is ready to publish.
---

# Prepare an Orbit release

Separate engineering readiness from external publication. Publishing, pushing, tagging, and creating a GitHub release require explicit user authorization.

## Workflow

1. Confirm the requested version and release channel.
2. Inspect the working tree, current branch, remotes, package versions, lockfile, and existing tags without changing them.
3. Update every version source consistently and add release notes when requested.
4. Run the release gate and inspect the packed artifact rather than trusting source-tree tests alone.
5. Verify the artifact excludes credentials, local paths, `.orbit`, tests, source maps, and private fixtures.
6. Record the commit, tag, artifact checksum, test results, dependency audit, and rollback procedure.
7. Only after authorization, commit/push/tag, create the GitHub release, and publish the exact verified artifact with provenance.
8. Confirm GitHub and npm expose the intended version, then report immutable URLs and hashes.

Read [references/release-gates.md](references/release-gates.md) for commands, authority boundaries, and stop conditions. Also consult `docs/COMMERCIAL_RELEASE_CHECKLIST.md` for owner decisions that automation cannot satisfy.

## Stop conditions

Do not publish when the working tree contains unexplained changes, versions disagree, release verification fails, package contents are unexpected, credentials are exposed, or the target version already exists with different contents.
