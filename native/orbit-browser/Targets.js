// Runs in a WebKit isolated content world. The page and model cannot supply scripts.
(() => {
  const targets = new Map();
  let observedURL;
  function inspect(el) {
    if (!el.isConnected || el.matches(":disabled,[aria-disabled=true]") ||
        el.closest("[inert],[hidden],[aria-hidden=true]")) return;
    for (let parent = el; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.opacity === "0" || style.visibility !== "visible") return;
    }
    const r = el.getBoundingClientRect();
    const x = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2;
    const y = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2;
    if (r.width < 2 || r.height < 2 || !el.contains(document.elementFromPoint(x, y))) return;
    const role = el.matches("a[href]") ? "link" : "button";
    const label = (el.getAttribute("aria-label") || el.innerText || el.title || "").trim().replace(/\s+/g, " ").slice(0, 120);
    return label && { role, label, href: role === "link" ? el.href : "" };
  }
  globalThis.orbitObserve = () => {
    targets.clear();
    observedURL = location.href;
    const controls = [];
    let inspected = 0;
    for (const el of document.querySelectorAll("button,a[href],[role=button]")) {
      if (++inspected > 2000) break;
      const info = inspect(el);
      if (!info) continue;
      const id = crypto.randomUUID();
      targets.set(id, { el, ...info });
      controls.push({ id, label: info.label, role: info.role });
      if (controls.length === 48) break;
    }
    return { site: location.origin, title: document.title.slice(0, 160), controls };
  };
  globalThis.orbitClick = id => {
    const target = targets.get(id);
    targets.clear();
    const now = observedURL === location.href && target && inspect(target.el);
    if (!now || now.label !== target.label || now.role !== target.role || now.href !== target.href) return false;
    target.el.click();
    return true;
  };
})();
