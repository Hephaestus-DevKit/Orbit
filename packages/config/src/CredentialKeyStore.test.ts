import { describe, expect, it, mockTools as vi } from "../../../scripts/testing/support.mjs";
import { LinuxSecretServiceKeyStore, MacOSKeychainKeyStore } from "./CredentialKeyStore.js";

describe("MacOSKeychainKeyStore", () => {
  it("uses bounded security CLI arguments without exposing output", () => {
    const key = Buffer.alloc(32, 9);
    const run = vi.fn().mockReturnValue(`${key.toString("base64")}\n`);
    const store = new MacOSKeychainKeyStore({ run });

    expect(store.load()).toEqual(key);
    store.store(key);
    store.delete();

    expect(run.mock.calls[0]?.[0]).toBe("security");
    expect(run.mock.calls[0]?.[1]).toEqual([
      "find-generic-password",
      "-a",
      "master-key",
      "-s",
      "dev.hephaestus.orbit.credentials",
      "-w",
    ]);
    expect(run.mock.calls[1]?.[1]).toContain("add-generic-password");
    expect(run.mock.calls[2]?.[1]).toContain("delete-generic-password");
  });

  it("treats a missing item as an idempotent result", () => {
    const missing = Object.assign(new Error("missing"), { status: 44 });
    const run = vi.fn().mockImplementation(() => {
      throw missing;
    });
    const store = new MacOSKeychainKeyStore({ run });

    expect(store.load()).toBeNull();
    expect(() => store.delete()).not.toThrow();
  });

  it("does not hide unexpected Keychain failures", () => {
    const store = new MacOSKeychainKeyStore({
      run: () => {
        throw Object.assign(new Error("locked"), { status: 1 });
      },
    });

    expect(() => store.load()).toThrow("Unable to read");
    expect(() => store.delete()).toThrow("Unable to remove");
  });
});

describe("LinuxSecretServiceKeyStore", () => {
  it("stores, loads, and deletes a validated key", () => {
    const key = Buffer.alloc(32, 9);
    let stored = "";
    const calls: string[][] = [];
    const store = new LinuxSecretServiceKeyStore({
      run: (_executable, args, input) => {
        calls.push(args);
        if (args[0] === "store") stored = input?.trim() ?? "";
        if (args[0] === "lookup") return stored;
        if (args[0] === "clear") stored = "";
        return "";
      },
    });

    store.store(key);
    expect(store.load()).toEqual(key);
    store.delete();
    expect(store.load()).toBeNull();
    expect(calls.map(([command]) => command)).toEqual([
      "store",
      "lookup",
      "clear",
      "lookup",
    ]);
  });

  it("degrades when Secret Service is unavailable", () => {
    const unavailable = Object.assign(new Error("missing"), { code: "ENOENT" });
    const store = new LinuxSecretServiceKeyStore({
      run: () => {
        throw unavailable;
      },
    });

    expect(store.load()).toBeNull();
    expect(() => store.delete()).not.toThrow();
    expect(() => store.store(Buffer.alloc(32))).toThrow("missing");
  });

  it("rejects a malformed stored key", () => {
    const store = new LinuxSecretServiceKeyStore({ run: () => "not-a-key" });
    expect(() => store.load()).toThrow("Secret Service is invalid");
  });
});
