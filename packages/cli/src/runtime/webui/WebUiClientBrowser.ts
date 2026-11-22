type AddressResult = { url: URL } | { error: "invalid" | "private" | "local" };

/** Resolve a user-entered website without navigating or disclosing workspace credentials. */
export function resolveBrowserAddress(input: string, workspaceOrigin: string): AddressResult {
  const raw = input.trim();
  if (
    !raw || raw.length > 8192 || /[\s\\]/u.test(raw) || /^[/?#]/.test(raw)
    || Array.from(raw).some(c => c.charCodeAt(0) < 32)
  )
    return { error: "invalid" };
  const local = /^(?:localhost|127\.0\.0\.1)(?=[:/?#]|$)/i.test(raw);
  const absolute = /^https?:\/\/[^/?#]/i.test(raw);
  if (!absolute && !local && !/^[^/:?#]+\.[^/:?#]+(?=[:/?#]|$)/u.test(raw))
    return { error: "invalid" };
  try {
    const url = new URL(absolute ? raw : (local ? "http://" : "https://") + raw);
    const workspace = new URL(workspaceOrigin);
    if (url.username || url.password || new URLSearchParams(url.hash.slice(1)).has("token"))
      return { error: "private" };
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      // Cookies are shared across ports. Local preview uses a separate host from Orbit.
      if (
        workspace.hostname !== "127.0.0.1"
        || (url.port || (url.protocol === "https:" ? "443" : "80")) === (workspace.port || "80")
      )
        return { error: "local" };
      url.hostname = "localhost";
    } else if (url.protocol !== "https:" || url.hostname === workspace.hostname)
      return { error: "invalid" };
    return { url };
  } catch {
    return { error: "invalid" };
  }
}

/** Bind the native browsing surface. Only addresses explicitly opened here enter its history. */
export function bindBrowserPreview(
  resolve: typeof resolveBrowserAddress,
  canShare: () => boolean,
  returnToChat: () => void,
  openNative: (url?: string) => Promise<unknown>,
): void {
  const get = (id: string) => document.getElementById(id)!;
  const input = get("browserAddress") as HTMLInputElement;
  const back = get("browserBack") as HTMLButtonElement;
  const forward = get("browserForward") as HTMLButtonElement;
  const reload = get("browserReload") as HTMLButtonElement;
  const link = get("browserExternal") as HTMLAnchorElement;
  const view = get("browserViewport");
  const error = get("browserAddressError");
  const entries: string[] = [];
  let index = -1;
  let pendingTimer: number | undefined;

  const launch = get("orbitBrowserLaunch") as HTMLButtonElement;
  const launchRow = get("orbitBrowserLaunchRow");
  launchRow.hidden = launchRow.dataset.local !== "true" || !navigator.platform.startsWith("Mac");
  launch.addEventListener("click", async () => {
    const typed = input.value.trim();
    const resolved = typed ? resolve(typed, location.origin) : undefined;
    if (resolved && "error" in resolved) {
      error.textContent = error.dataset[resolved.error]!;
      error.hidden = false;
      input.focus();
      return;
    }
    launch.disabled = true;
    clearError();
    try {
      await openNative(resolved?.url.href);
    } catch {
      error.textContent = launch.dataset.error!;
      error.hidden = false;
    } finally {
      launch.disabled = false;
    }
  });

  function clearError(): void {
    error.hidden = true;
    error.textContent = "";
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
  function render(): void {
    const address = entries[index];
    clearError();
    back.disabled = index <= 0;
    forward.disabled = index + 1 >= entries.length;
    reload.disabled = !address;
    get("browserStart").hidden = !!address;
    get("browserPageActions").hidden = !address;
    view.hidden = !address;
    input.value = address || "";
    window.clearTimeout(pendingTimer);
    view.removeAttribute("aria-busy");
    view.replaceChildren();
    if (!address) {
      link.removeAttribute("href");
      return;
    }
    link.href = address;
    const frame = document.createElement("iframe");
    frame.title = view.dataset.title + " · " + new URL(address).host;
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.referrerPolicy = "no-referrer";
    view.setAttribute("aria-busy", "true");
    const finish = () => {
      if (frame.parentElement !== view) return;
      window.clearTimeout(pendingTimer);
      view.removeAttribute("aria-busy");
    };
    frame.addEventListener("load", finish, { once: true });
    pendingTimer = window.setTimeout(finish, 10000);
    frame.src = address;
    view.append(frame);
  }

  get("browserAddressForm").addEventListener("submit", event => {
    event.preventDefault();
    const result = resolve(input.value, location.origin);
    if ("error" in result) {
      error.textContent = error.dataset[result.error]!;
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", error.id);
      input.focus();
      return;
    }
    const address = result.url.href;
    if (entries[index] !== address) {
      entries.splice(index + 1);
      entries.push(address);
      if (entries.length > 100) entries.shift();
      index = entries.length - 1;
    }
    render();
  });
  input.addEventListener("input", clearError);
  back.addEventListener("click", () => {
    index--;
    render();
  });
  forward.addEventListener("click", () => {
    index++;
    render();
  });
  reload.addEventListener("click", render);
  get("browserClear").addEventListener("click", () => {
    entries.length = 0;
    index = -1;
    render();
    input.focus();
  });
  get("browserShare").addEventListener("click", () => {
    if (!entries[index]) return;
    const address = new URL(entries[index]);
    address.search = "";
    address.hash = "";
    if (!canShare()) {
      clearError();
      error.textContent = error.dataset.chat!;
      error.hidden = false;
      return;
    }
    const prompt = get("prompt") as HTMLTextAreaElement;
    prompt.value += (prompt.value ? "\n\n" : "") + address.href;
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    clearError();
    returnToChat();
    prompt.focus();
    prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  });
}

export const WEB_UI_CLIENT_BROWSER_SCRIPT =
  `(${bindBrowserPreview.toString()})(${resolveBrowserAddress.toString()}, () => state.ready && !state.sessionChanging && !state.projectLaunchPending && !!drafts.active && !elements.prompt.disabled, () => setWorkbench(null, false), address => api("/api/browser/open", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({address}) }));\n`;
