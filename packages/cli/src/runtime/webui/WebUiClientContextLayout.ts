interface ContextPickerElements {
  contextPicker: HTMLElement;
  contextPickerButton: HTMLElement;
}

/** Keep the file picker outside clipped composers and inside the visible viewport. */
export function createContextPickerLayout(elements: ContextPickerElements) {
  const panel = elements.contextPicker;
  document.body.append(panel);

  function positionContextPicker() {
    if (panel.hidden) return;
    const viewport = window.visualViewport;
    const edge = 12;
    const left = (viewport?.offsetLeft ?? 0) + edge;
    const top = (viewport?.offsetTop ?? 0) + edge;
    const width = Math.max(
      0,
      (viewport?.width ?? window.innerWidth) - edge * 2,
    );
    const height = Math.max(
      0,
      (viewport?.height ?? window.innerHeight) - edge * 2,
    );
    panel.style.width = Math.min(560, width) + "px";
    panel.style.maxHeight = Math.min(440, height) + "px";
    const trigger = elements.contextPickerButton.getBoundingClientRect();
    const panelHeight = panel.offsetHeight;
    const above = trigger.top - panelHeight - 9;
    const preferredTop = above >= top ? above : trigger.bottom + 9;
    panel.style.left = Math.max(left, Math.min(trigger.left, left + width - panel.offsetWidth))
      + "px";
    panel.style.top = Math.max(top, Math.min(preferredTop, top + height - panelHeight)) + "px";
  }

  // These listeners live with the page, just like the picker itself.
  new ResizeObserver(positionContextPicker).observe(panel);
  window.addEventListener("resize", positionContextPicker, { passive: true });
  window.visualViewport?.addEventListener("resize", positionContextPicker);
  window.visualViewport?.addEventListener("scroll", positionContextPicker);
  document.addEventListener(
    "scroll",
    (event) => {
      if (!(event.target instanceof Node) || !panel.contains(event.target)) {
        positionContextPicker();
      }
    },
    true,
  );
  return positionContextPicker;
}
