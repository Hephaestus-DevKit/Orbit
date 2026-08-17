# Agent Profiles

Agent Profiles are small, reviewable YAML/JSON manifests for repeatable Agent
roles. They are the stable customization boundary for model, tool, permission,
prompt, MCP, memory, isolation, Skill, and lifecycle-hook policy. Hook commands
are executable policy and therefore pass through the same permission,
cancellation, timeout, redaction, and audit boundary as project lifecycle hooks.

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

Installed extensions may contribute declarative profiles under
`<profile-directory>/extensions/<extension-id>`. Orbit reads only regular
YAML/JSON files directly inside each extension namespace (never nested
directories or links), after direct profiles in that directory, so a project
or user-authored profile always wins a duplicate name. Extension installation
validates the Profile schema and requires explicit `--trust` when a contributed
Profile owns lifecycle hooks.

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
mcpServers:
  - docs
hooks:
  preToolUse:
    - command: npm run policy:check
      matcher: "write_*"
      onFailure: block
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
orbit                         # then use /agent reviewer in the TUI/REPL
```

`--agent-profile` applies to one-shot task runs and can also configure the
profile used by multi-agent planning/coding. WebUI settings and the shared
`/agent [profile|default]` command provide an explicit idle-only selection flow
for browser, REPL, and fullscreen TUI sessions. Switching profiles resets the
old MCP runtime before the next task so tools from the previous role cannot
leak into the new one.

## Safety rules

- `allowedTools` is an allow-list; `disallowedTools` is applied afterwards.
- Managed policy remains authoritative for provider, model, permission, and
  iteration limits.
- A profile cannot silently lower the active safety mode. Selecting Full Access
  still requires the existing explicit `--yes`/WebUI confirmation boundary.
- `isolation: worktree` is reserved for an explicitly isolated orchestration
  entry point. One-shot and interactive main-workspace selection reject it
  instead of silently ignoring the isolation contract.
- `mcpServers` is an allow-list. An empty list disables MCP for the role;
  omission keeps all configured servers. Unknown names are reported and never
  create implicit server definitions.
- Profile hooks run before matching global hooks. Both reuse the normal command
  permission engine and preserve `block|warn|ignore` failure semantics.
- Profile prompt text is never interpreted as a command or credential source;
  only commands under the explicit `hooks` object are executable.

## Troubleshooting

Use `orbit doctor --json --strict` to make invalid profile manifests visible to
automation. `orbit agents validate --json` reports the exact file, diagnostic
code, and bounded remediation message without echoing secret material.
