# Agent Profiles

Agent Profiles are small, reviewable YAML/JSON manifests for repeatable
one-shot Agent runs. They are the stable customization boundary for model,
tool, permission, and prompt policy; they do not execute arbitrary code.

## Discovery and precedence

Orbit searches the configured directories in order and keeps the first profile
with a given name:

1. `.agents/agents`
2. `.orbit/agents`
3. `.claude/agents`
4. `~/.orbit/agents`
5. `~/.claude/agents`

Project files are intentionally ahead of user files so a repository can ship a
reviewed team contract. Symbolic-link profile files, oversized manifests, and
invalid YAML/JSON are rejected with diagnostics. A duplicate name never
silently replaces an earlier profile.

## Example

Save this as `.agents/agents/reviewer.yaml`:

```yaml
schemaVersion: 1
name: reviewer
displayName: Security reviewer
description: Read-only security and regression review.
model: deepseek-v4-pro
effort: high
permissionMode: strict
allowedTools:
  - read_file
  - list_files
  - glob
  - grep
  - git_status
  - git_diff
disallowedTools:
  - bash
  - write_file
  - edit_file
maxTurns: 80
isolation: workspace
memory: none
systemPrompt: |
  Prioritize credential handling, traversal, approval, and cancellation paths.
```

Profiles may inherit one parent profile from the same discovered catalog. The
child only overrides fields that it explicitly declares; schema defaults do not
erase inherited values. Inheritance is bounded to eight levels and cycles fail
closed with a diagnostic before any Agent starts:

```yaml
name: fast-reviewer
extends: reviewer
model: deepseek-v4-flash
effort: low
```

`effort` is normalized by the selected model family. Generic providers retain
the requested `low|medium|high|xhigh|max` level; DeepSeek V4 maps the five
levels to its native `low|high|max` contract and preserves the matching token
budget. This keeps one profile portable across official DeepSeek, compatible
gateways, and other providers.

Run it with:

```text
orbit --agent-profile reviewer "Review the current worktree for security regressions"
orbit agents list --json
orbit agents validate --json
```

`--agent-profile` applies to one-shot task runs and can also configure the
profile used by multi-agent planning/coding. Interactive REPL profile switching
is deliberately not implicit; it will be exposed through an explicit UI
selection flow once its approval and persistence contract is complete.

## Safety rules

- `allowedTools` is an allow-list; `disallowedTools` is applied afterwards.
- Managed policy remains authoritative for provider, model, permission, and
  iteration limits.
- A profile cannot silently lower the active safety mode. Selecting Full Access
  still requires the existing explicit `--yes`/WebUI confirmation boundary.
- `isolation: worktree` is reserved for an explicitly isolated orchestration
  entry point and is rejected by the one-shot resolver until that flow is
  selected.
- Profile text is prompt input only. It is never interpreted as a shell
  command, hook, extension, or credential source.

## Troubleshooting

Use `orbit doctor --json --strict` to make invalid profile manifests visible to
automation. `orbit agents validate --json` reports the exact file, diagnostic
code, and bounded remediation message without echoing secret material.
