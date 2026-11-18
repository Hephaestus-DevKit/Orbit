import { describe, expect, it, mockTools as vi } from "../../../../../scripts/testing/support.mjs";
import {
  bindAuthenticationLinkRecovery,
  WEB_UI_CLIENT_AUTHENTICATION_SCRIPT,
} from "./WebUiClientAuthentication.js";

describe("authentication link recovery", () => {
  const token = "a".repeat(43);
  const bind = (hash: string) => {
    let listener = () => {};
    const reload = vi.fn();
    bindAuthenticationLinkRecovery({
      subscribe: (callback) => {
        listener = callback;
      },
      getHash: () => hash,
      reload,
    });
    expect(reload).not.toHaveBeenCalled();
    listener();
    return reload;
  };

  it("reloads an existing page only after receiving a complete authentication fragment", () => {
    expect(bind(`#token=${token}`)).toHaveBeenCalledOnce();
  });

  it.each([
    "",
    "#settings",
    "#token=",
    "#token=short",
    `#token=${token}&token=${token}`,
    `#token=${token};$(touch /tmp/unsafe)`,
    `#token=${"x".repeat(2049)}`,
  ])("ignores empty, ambiguous, or invalid fragments", (hash) => {
    expect(bind(hash)).not.toHaveBeenCalled();
  });

  it("ships a standalone script without build helper dependencies", () => {
    expect(
      () => new Function(WEB_UI_CLIENT_AUTHENTICATION_SCRIPT),
    ).not.toThrow();
    expect(WEB_UI_CLIENT_AUTHENTICATION_SCRIPT).not.toContain("__name");
  });
});
