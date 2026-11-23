// Runs in a WebKit isolated content world. The page and model cannot supply scripts.
(() => {
  const targets = new Map();
  let observedURL;
  function visible(el) {
    if (!el?.isConnected || el.closest("[inert],[hidden],[aria-hidden=true]")) return false;
    for (let parent = el; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.opacity === "0" || style.visibility !== "visible" || style.display === "none") return false;
    }
    return true;
  }
  function labelOf(el) {
    const refs = (el.getAttribute("aria-labelledby") || "").trim().split(/\s+/).slice(0, 8);
    const editable = "input,textarea,select,[contenteditable]:not([contenteditable=false])";
    const named = refs.filter(Boolean).map(id => document.getElementById(id))
      .filter(node => visible(node) && !node.closest(editable) && !node.querySelector(editable))
      .map(node => node.innerText?.trim().slice(0, 120)).filter(Boolean).join(" ");
    const icon = el.querySelector("img[alt],svg");
    const iconName = visible(icon) && (icon.getAttribute("alt") || icon.querySelector("title")?.textContent);
    return (named || el.getAttribute("aria-label")?.trim() || el.innerText?.trim() || iconName || el.title || "")
      .replace(/[\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  function inspect(el) {
    if (!visible(el) || el.matches(":disabled,[aria-disabled=true]")) return;
    const r = el.getBoundingClientRect();
    const x = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2;
    const y = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2;
    if (r.width < 2 || r.height < 2 || !el.contains(document.elementFromPoint(x, y))) return;
    const role = el.matches("a[href]") ? "link" : "button";
    const label = labelOf(el);
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
    return now.label;
  };
})();
