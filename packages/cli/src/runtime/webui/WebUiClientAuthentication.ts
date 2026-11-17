export interface AuthenticationLinkRuntime {
  subscribe(listener: () => void): void;
  getHash(): string;
  reload(): void;
}

/** Bootstrap again when an already-open page receives a fresh authentication link. */
export function bindAuthenticationLinkRecovery(
  runtime: AuthenticationLinkRuntime,
): void {
  runtime.subscribe(() => {
    const hash = runtime.getHash();
    if (hash.length > 2048) return;
    const tokens = new URLSearchParams(hash.replace(/^#/, "")).getAll("token");
    if (tokens.length === 1 && /^[A-Za-z0-9_-]{32,128}$/.test(tokens[0])) {
      // Reloading reuses the existing bootstrap path and discards stale
      // in-flight requests. Draft input is already saved on every input event.
      runtime.reload();
    }
  });
}

export const WEB_UI_CLIENT_AUTHENTICATION_SCRIPT = `(${bindAuthenticationLinkRecovery.toString()})({ subscribe: (listener) => window.addEventListener('hashchange', listener), getHash: () => location.hash, reload: () => location.reload() });\n`;
