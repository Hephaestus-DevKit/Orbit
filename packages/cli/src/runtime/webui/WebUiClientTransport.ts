export interface BrowserApiOptions extends RequestInit {
  responseType?: "blob";
}

export interface BrowserApiRuntime {
  getToken(): string;
  getUseBearer(): boolean;
  setUseBearer(value: boolean): void;
  recoverAuthenticatedSession(): Promise<boolean>;
  accessExpired: string;
  fetchImpl?: typeof fetch;
}

/** Authenticated same-origin transport with bounded recovery and validated JSON envelopes. */
export function createAuthenticatedApi(runtime: BrowserApiRuntime) {
  const fetchImpl = runtime.fetchImpl ?? fetch;
  return async function api(
    url: string,
    options: BrowserApiOptions = {},
  ): Promise<Record<string, unknown> | Blob> {
    if (!url.startsWith("/api/") || url.includes("\\") || /[\r\n]/.test(url)) {
      throw new Error("Orbit API requests must target a local API route.");
    }
    const { responseType, ...requestOptions } = options;
    const requestApi = (useBearer: boolean): Promise<Response> => {
      const headers = new Headers(options.headers);
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
      if (useBearer && runtime.getToken() && !headers.has("Authorization")) {
        headers.set("Authorization", "Bearer " + runtime.getToken());
      }
      return fetchImpl(url, {
        ...requestOptions,
        credentials: "same-origin",
        headers,
      });
    };
    let response = await requestApi(runtime.getUseBearer());
    if (
      response.status === 401 &&
      runtime.getToken() &&
      !runtime.getUseBearer()
    ) {
      await response.body?.cancel().catch(() => {});
      runtime.setUseBearer(true);
      response = await requestApi(true);
    }
    if (
      response.status === 401 &&
      (await runtime.recoverAuthenticatedSession())
    ) {
      await response.body?.cancel().catch(() => {});
      response = await requestApi(false);
    }
    // A confirmed download may itself be JSON; consume its body only once.
    if (responseType === "blob" && response.ok) return response.blob();
    let data: Record<string, unknown> = {};
    if (
      (response.headers.get("content-type") ?? "").includes("application/json")
    ) {
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Orbit API returned an invalid response envelope.");
      }
      data = value as Record<string, unknown>;
    }
    if (!response.ok || data.ok === false) {
      const message =
        response.status === 401
          ? runtime.accessExpired
          : typeof data.message === "string"
            ? data.message
            : typeof data.error === "string"
              ? data.error
              : response.statusText || "Request failed";
      throw Object.assign(new Error(message.slice(0, 2000)), {
        status: response.status,
        projectErrorCode:
          typeof data.errorCode === "string" ? data.errorCode : "",
      });
    }
    return responseType === "blob" ? response.blob() : data;
  };
}

export const WEB_UI_CLIENT_TRANSPORT_SCRIPT = `  const api = (${createAuthenticatedApi.toString()})({
  getToken: () => webSessionToken,
  getUseBearer: () => state.useBearerTransport,
  setUseBearer: (value) => { state.useBearerTransport = value; },
  recoverAuthenticatedSession,
  accessExpired: copy.accessExpired,
});\n\n`;
