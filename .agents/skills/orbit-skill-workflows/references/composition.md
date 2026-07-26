# Skill and workflow composition

## Versioned project layout

```text
.agents/
└── skills/
    └── skill-name/
        ├── SKILL.md
        ├── agents/openai.yaml
        ├── references/
        ├── scripts/
        └── assets/

.orbit/
└── commands/
    └── command-name.md
```

`.orbit` is runtime-local in this repository and ignored by Git. Use `.agents/skills` for first-party Orbit Skills that must ship with the repository. A distributable extension can materialize commands into `.orbit/commands/<name>.md` and Skills into `.orbit/skills/<name>/SKILL.md`.

## Frontmatter

```markdown
---
name: inspect-api
description: Inspect and diagnose API behavior. Use for API failures, contract changes, response validation, and endpoint debugging.
---
```

Use only `name` and `description`. Keep the description concrete enough to distinguish intended triggers from nearby tasks.

## Explicit command composition

```markdown
---
description: Run the verified API inspection workflow
argument-hint: <endpoint-or-scope>
---

Use $inspect-api to inspect $ARGUMENTS. Preserve read-only behavior unless the user explicitly asks for a fix.
```

Use `$skill-name`, `skill:skill-name`, or `技能:skill-name` for explicit activation. Keep automatic activation enabled for broadly useful expertise and use the WebUI per-Skill switch to suppress noisy Skills without deleting them.
