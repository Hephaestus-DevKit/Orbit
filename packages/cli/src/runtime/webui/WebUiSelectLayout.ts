interface SelectMenuLayoutInput {
  trigger: { top: number; bottom: number; left: number; width: number };
  viewportWidth: number;
  viewportHeight: number;
  contentHeight: number;
  minimumWidth: number;
  preferTop: boolean;
  placement?: "top" | "bottom";
}

/** Fit a floating menu to the available side without covering its trigger. */
export function selectMenuLayout(input: SelectMenuLayoutInput) {
  const { trigger, viewportWidth, viewportHeight, preferTop } = input;
  const gap = 7;
  const edge = 10;
  const above = Math.max(0, trigger.top - edge - gap);
  const below = Math.max(0, viewportHeight - trigger.bottom - edge - gap);
  const desiredHeight = Math.min(320, input.contentHeight);
  const openAbove = input.placement
    ? input.placement === "top"
    : (preferTop && above >= desiredHeight) ||
      (below < desiredHeight && above > below);
  const maxHeight = Math.min(320, Math.floor(openAbove ? above : below));
  const height = Math.min(desiredHeight, maxHeight);
  const width = Math.max(
    0,
    Math.min(
      Math.max(trigger.width, input.minimumWidth),
      viewportWidth - edge * 2,
    ),
  );
  return {
    width,
    maxHeight,
    left: Math.max(edge, Math.min(trigger.left, viewportWidth - width - edge)),
    top: openAbove ? trigger.top - gap - height : trigger.bottom + gap,
    placement: openAbove ? "top" : "bottom",
  };
}
