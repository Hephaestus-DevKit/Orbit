---
name: orbit-webui-craft
description: Design, implement, and validate refined Orbit WebUI experiences across layout, interaction, accessibility, responsive behavior, streaming state, and visual consistency. Use for WebUI 页面、界面美化、设置面板、聊天交互、响应式布局、可访问性或浏览器端行为 changes in packages/cli/src/runtime/webui.
---

# Craft the Orbit WebUI

Extend the existing visual system instead of creating an isolated microsite aesthetic.

## Workflow

1. Inspect the current page, client, data, runtime, security, and style modules that own the feature.
2. Define the user-visible states before styling: loading, empty, success, disabled, error, reconnecting, and narrow viewport.
3. Keep server contracts typed and validated; keep client rendering safe with `textContent` for external data.
4. Place markup, behavior, data access, and CSS in their existing responsibility modules.
5. Use existing spacing, typography, color variables, radii, controls, and motion conventions.
6. Add focused server/client/style tests.
7. Validate the live page in a real browser at the default viewport and a relevant narrow breakpoint.
8. Check keyboard reachability, accessible names, focus state, scroll containment, and browser errors.

Read [references/quality-checklist.md](references/quality-checklist.md) before final visual validation.

## Product quality bar

- Keep the main chat visually dominant; secondary tools belong in contained surfaces.
- Prefer clear hierarchy and restrained density over decoration.
- Avoid hard-coded colors when a semantic CSS variable exists.
- Avoid horizontal overflow and controls that collapse into ambiguous icon-only actions.
- Preserve SSE reconnect, cancellation, instance isolation, authentication, CSP, redaction, and approval boundaries.
- Do not claim visual completion from source inspection alone; inspect the rendered result.
