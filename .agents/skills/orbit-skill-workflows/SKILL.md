---
name: orbit-skill-workflows
description: Create, revise, diagnose, and compose Orbit Skills and reusable prompt workflows using SKILL.md, optional references/scripts/assets, custom slash commands, extensions, and WebUI controls. Use when adding a skill、技能、工作流、workflow、斜杠命令, improving activation accuracy, packaging reusable expertise, or deciding between a Skill and a command.
---

# Build Orbit Skills and workflows

Use the smallest reusable primitive that matches the task.

## Choose the primitive

- Use a **Skill** for reusable expertise and procedures that should enter model context.
- Use a **custom command** for an explicit, repeatable prompt entry point with arguments.
- Use a **Skill plus command** when a discoverable procedure also needs a convenient one-click or slash launcher.
- Use an **extension** when commands or Skills must be installed and versioned as a distributable bundle.
- Add deterministic scripts only when repeated implementation would otherwise be fragile or wasteful.

Read [references/composition.md](references/composition.md) for directory ownership, naming, activation, and composition patterns.

## Skill workflow

1. Collect realistic trigger prompts and non-trigger counterexamples.
2. Choose a short lowercase hyphenated name.
3. Write strict frontmatter containing only `name` and a trigger-rich `description`.
4. Keep `SKILL.md` procedural and concise; put optional detail in one-level `references/`.
5. Put executable repeatable logic in `scripts/` and output templates in `assets/`.
6. Validate discovery and diagnostics through the WebUI Skills panel.
7. Test explicit invocation with `$skill-name`, then test intended automatic matches and false positives.
8. Keep per-project Skills in `.agents/skills` when they must be versioned; use `.orbit/skills` only for local runtime customization.

## Workflow composition

Keep commands thin: collect arguments, state the desired outcome, and explicitly invoke the relevant Skill. Do not duplicate the entire Skill body inside the command. Keep destructive or external actions behind normal Orbit permission and user-authorization boundaries.
