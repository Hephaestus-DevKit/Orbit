/** Translate deliberate desktop input to bounded events, without injecting website HTML. */
export const WEB_UI_CLIENT_BROWSER_INPUT_SCRIPT = String.raw`
  function initializeBrowserPageInput({ picture, stage, panel, url, getCurrent, blocked, send, onContextMenu, copySelection }) {
    const sink = byId('browserPageInput');
    const defaultSinkLabel = sink.getAttribute('aria-label') || '';
    let queue = [], flushing = false, timer, composing = false, disposed = false, pageId = '', held = false, lastPoint = { x: 0, y: 0 };
    const keys = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
    function available() { return !disposed && !panel.hidden && !picture.hidden && getCurrent()?.active && !blocked() && !getCurrent()?.dialog; }
    function enqueue(event) {
      if (!available()) return;
      const id = getCurrent().pageId;
      if (id !== pageId) { queue = []; pageId = id; }
      // Hover is replaceable. Clicks, text and key presses retain their ordering.
      if (event.type === 'pointer' && event.phase === 'move' && queue.at(-1)?.phase === 'move') queue[queue.length - 1] = event;
      else if (queue.length < 256) queue.push(event);
      if (timer === undefined) timer = setTimeout(flush, 16);
    }
    async function flush() {
      timer = undefined;
      if (flushing || !queue.length || disposed) return;
      if (!available() || getCurrent().pageId !== pageId) { queue = []; return; }
      flushing = true;
      const id = pageId, events = queue.splice(0, 32);
      try { if (!await send({ action: 'input', pageId: id, events }, true)) queue = []; }
      finally { flushing = false; if (queue.length) timer = setTimeout(flush, 16); }
    }
    function point(event) {
      const rect = picture.getBoundingClientRect(), current = getCurrent();
      if (!rect.width || !rect.height || !current) return null;
      return { x: Math.max(0, Math.min(current.width - 1, (event.clientX - rect.left) * current.width / rect.width)), y: Math.max(0, Math.min(current.height - 1, (event.clientY - rect.top) * current.height / rect.height)) };
    }
    function modifiers(event) {
      return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
    }
    function pointer(event, phase) {
      if (!available() || event.button > 0 && phase !== 'move') return;
      const position = point(event); if (!position) return;
      lastPoint = position;
      if (phase === 'down') { event.preventDefault(); sink.focus({ preventScroll: true }); picture.setPointerCapture(event.pointerId); held = true; }
      enqueue({ type: 'pointer', phase, ...position, button: 'left', clicks: event.detail > 1 ? 2 : 1, modifiers: modifiers(event) });
      if (phase === 'up') { held = false; if (picture.hasPointerCapture(event.pointerId)) picture.releasePointerCapture(event.pointerId); }
    }
    picture.addEventListener('pointerdown', (event) => pointer(event, 'down'));
    picture.addEventListener('pointerup', (event) => pointer(event, 'up'));
    picture.addEventListener('pointermove', (event) => pointer(event, 'move'));
    picture.addEventListener('pointercancel', () => { if (held) enqueue({ type: 'pointer', phase: 'up', ...lastPoint, button: 'left', clicks: 1 }); held = false; });
    picture.addEventListener('contextmenu', (event) => { event.preventDefault(); if (available()) onContextMenu(event.clientX, event.clientY); });
    stage.addEventListener('wheel', (event) => {
      if (event.shiftKey && !panel.hidden && !picture.hidden && stage.scrollWidth > stage.clientWidth + 2) {
        event.preventDefault();
        const multiplier = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? stage.clientWidth : 1;
        stage.scrollLeft += (event.deltaY || event.deltaX) * multiplier;
        return;
      }
      if (!available()) return;
      event.preventDefault();
      const position = point(event); if (!position) return;
      const multiplier = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? getCurrent().height : 1;
      enqueue({ type: 'wheel', ...position, deltaX: Math.max(-3000, Math.min(3000, event.deltaX * multiplier)), deltaY: Math.max(-3000, Math.min(3000, event.deltaY * multiplier)) });
    }, { passive: false });
    stage.addEventListener('keydown', (event) => {
      if (event.target === stage && event.key === 'Enter' && available()) { event.preventDefault(); event.stopPropagation(); sink.focus({ preventScroll: true }); }
      else if (event.target === stage && event.shiftKey && event.key === 'F10' && available()) { event.preventDefault(); event.stopPropagation(); onContextMenu(); }
    });
    sink.addEventListener('compositionstart', () => { composing = true; });
    sink.addEventListener('compositionend', () => { composing = false; consumeText(); });
    function consumeText() {
      if (composing || !sink.value) return;
      const text = sink.value; sink.value = '';
      for (let offset = 0; offset < text.length; offset += 8000) enqueue({ type: 'text', text: text.slice(offset, offset + 8000) });
    }
    sink.addEventListener('input', consumeText);
    sink.addEventListener('blur', () => { sink.setAttribute('aria-label', defaultSinkLabel); });
    sink.addEventListener('keydown', (event) => {
      if (composing || event.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'l') { event.preventDefault(); event.stopPropagation(); url.focus(); return; }
      if (command && event.key.toLowerCase() === 'k') return;
      if (command && ['f', 'g', 'r', 't', 'w'].includes(event.key.toLowerCase())) return;
      if (command && event.key.toLowerCase() === 'c') { event.preventDefault(); event.stopPropagation(); if (available()) void copySelection(); return; }
      if (event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); if (available()) onContextMenu(); return; }
      if (event.altKey) return;
      event.stopPropagation();
      if (!available()) {
        event.preventDefault();
        if (event.key === 'Escape') (url.disabled ? stage : url).focus({ preventScroll: true });
        return;
      }
      let key = keys.has(event.key) ? event.key : '';
      if (command && ['a', 'z', 'y'].includes(event.key.toLowerCase())) key = 'ControlOrMeta+' + event.key.toUpperCase();
      else if (command) { if (!['v', 'c'].includes(event.key.toLowerCase())) event.preventDefault(); return; }
      if (event.shiftKey && ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) key = 'Shift+' + key;
      if (key) { event.preventDefault(); enqueue({ type: 'key', key }); }
      if (event.key === 'Escape') { url.focus(); }
    });
    function release() {
      queue = []; pageId = ''; held = false; composing = false; sink.value = ''; clearTimeout(timer); timer = undefined;
      sink.setAttribute('aria-label', defaultSinkLabel);
      if (document.activeElement === sink) stage.focus({ preventScroll: true });
    }
    const blur = () => { if (held) { enqueue({ type: 'pointer', phase: 'up', ...lastPoint, button: 'left', clicks: 1 }); held = false; } };
    window.addEventListener('blur', blur);
    return { release, focusControl(label) { sink.setAttribute('aria-label', label); sink.focus({ preventScroll: true }); }, dispose() { disposed = true; release(); window.removeEventListener('blur', blur); } };
  }
`;
