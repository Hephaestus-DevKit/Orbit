# WebUI quality checklist

## Visual

- One clear primary action per surface.
- Consistent spacing rhythm, type scale, borders, radii, and semantic colors.
- Dense data remains scannable; empty states explain the next action.
- Light and dark themes retain readable contrast.
- No clipped text, accidental double scrollbars, or horizontal overflow.

## Interaction

- Every action exposes loading, disabled, success, and failure feedback.
- Destructive actions are distinct and confirmed where required.
- Streaming, cancellation, reconnect, and stale-instance behavior remain correct.
- Temporary settings tests are restored before handoff.

## Accessibility

- Controls have semantic roles and stable accessible names.
- Keyboard focus is visible and order follows the visual hierarchy.
- Status changes use suitable live/status semantics without noisy announcements.
- Icon-only controls include labels; color is never the only state signal.

## Browser validation

1. Open the built application through its real authenticated URL.
2. Navigate using user-visible controls.
3. Inspect the target state and take a screenshot.
4. Exercise each new control and restore mutable test values.
5. Test a narrow viewport appropriate to the surface.
6. Inspect browser errors and reset the viewport.
