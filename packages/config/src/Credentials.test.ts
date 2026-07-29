import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CredentialsManager } from "./Credentials.js";

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

describe("CredentialsManager tests", () => {
  let orbitDir: string;

  beforeEach(() => {
    orbitDir = mkdtempSync(join(tmpdir(), "orbit-credentials-test-"));
    vi.mocked(execFileSync).mockReset();
  });

  afterEach(() => {
    rmSync(orbitDir, { recursive: true, force: true });
  });

  it("should store and retrieve secrets correctly", () => {
    const manager = new CredentialsManager({
      orbitDir,
      platform: "linux",
      fallbackKey: Buffer.alloc(32, 7),
    });
    const secretsPath = join(orbitDir, "secrets.json");
    const testKey = "TEST_RESOLVED_API_KEY";
    const testSecret = "sk-proj-test1234567890abcdef";

    manager.storeSecret(testKey, testSecret);

    const retrieved = manager.getSecret(testKey);
    expect(retrieved).toBe(testSecret);

    manager.storeSecret(testKey, "replacement-secret");
    expect(manager.getSecret(testKey)).toBe("replacement-secret");
    expect(manager.hasSecret(testKey)).toBe(true);

    // Verify it is saved in secrets.json and not in plaintext
    expect(existsSync(secretsPath)).toBe(true);
    const rawContent = readFileSync(secretsPath, "utf8");
    expect(rawContent).not.toContain(testSecret); // must be encrypted!
    expect(rawContent).not.toContain("replacement-secret");

    // Verify missing keys return null
    expect(manager.getSecret("NON_EXISTENT_KEY")).toBeNull();
    expect(manager.deleteSecret("NON_EXISTENT_KEY")).toBe(false);
    expect(manager.deleteSecret(testKey)).toBe(true);
    expect(manager.hasSecret(testKey)).toBe(false);
    expect(manager.getSecret(testKey)).toBeNull();
  });

  it("does not touch the real user home", () => {
    const manager = new CredentialsManager({
      orbitDir,
      platform: "linux",
      fallbackKey: Buffer.alloc(32, 3),
    });

    manager.storeSecret("TEST_KEY", "test-value");

    expect(existsSync(join(orbitDir, "secrets.json"))).toBe(true);
  });

  it("rejects unsafe credential names and multiline values", () => {
    const manager = new CredentialsManager({
      orbitDir,
      platform: "linux",
      fallbackKey: Buffer.alloc(32, 5),
    });

    expect(() => manager.storeSecret("__proto__", "secret")).toThrow();
    expect(() => manager.storeSecret("SAFE_KEY", "first\nsecond")).toThrow();
    expect(manager.getSecret("__proto__")).toBeNull();
  });

  it("does not replace unsafe credential or master-key paths", () => {
    const secretsPath = join(orbitDir, "secrets.json");
    mkdirSync(secretsPath);
    const manager = new CredentialsManager({
      orbitDir,
      platform: "linux",
      fallbackKey: Buffer.alloc(32, 5),
    });

    expect(() => manager.storeSecret("SAFE_KEY", "secret")).toThrow(
      "regular file",
    );
    rmSync(secretsPath, { recursive: true });
    mkdirSync(join(orbitDir, "master.key"));
    const generatedKeyManager = new CredentialsManager({
      orbitDir,
      platform: "linux",
      keyStore: null,
    });
    expect(() => generatedKeyManager.storeSecret("SAFE_KEY", "secret")).toThrow(
      "regular file",
    );
  });

  it("isolates Windows PowerShell modules and preserves the DPAPI format", () => {
    const legacyCipherText = `01000000${"a".repeat(256)}`;
    const replacementSecret = "replacement-secret";
    const originalModulePath = process.env.PSModulePath;
    const originalMixedCaseModulePath = process.env.PsMoDuLePaTh;
    process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules";
    process.env.PsMoDuLePaTh = "C:\\incompatible-modules";

    vi.mocked(execFileSync)
      .mockReturnValueOnce(`${legacyCipherText}\r\n`)
      .mockReturnValueOnce(`${replacementSecret}\r\n`);

    try {
      const manager = new CredentialsManager({ orbitDir, platform: "win32" });
      manager.storeSecret("DEEPSEEK_API_KEY", replacementSecret);

      const rawSecrets = JSON.parse(
        readFileSync(join(orbitDir, "secrets.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(rawSecrets.DEEPSEEK_API_KEY).toBe(legacyCipherText);
      expect(manager.getSecret("DEEPSEEK_API_KEY")).toBe(replacementSecret);

      const calls = vi.mocked(execFileSync).mock.calls;
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call[0]).toBe("powershell.exe");
        const options = call[2] as { env?: NodeJS.ProcessEnv };
        expect(
          Object.keys(options.env ?? {}).some(
            (key) => key.toLowerCase() === "psmodulepath",
          ),
        ).toBe(false);
      }

      expect(calls[0]?.[1]).toContain("-Command");
      expect(String(calls[0]?.[1])).toContain("-ErrorAction Stop");
      expect(String(calls[1]?.[1])).toContain("PtrToStringBSTR");
      expect(String(calls[1]?.[1])).toContain("ZeroFreeBSTR");
    } finally {
      if (originalModulePath === undefined) {
        delete process.env.PSModulePath;
      } else {
        process.env.PSModulePath = originalModulePath;
      }
      if (originalMixedCaseModulePath === undefined) {
        delete process.env.PsMoDuLePaTh;
      } else {
        process.env.PsMoDuLePaTh = originalMixedCaseModulePath;
      }
    }
  });

  it("migrates a legacy macOS master key into Keychain", () => {
    const legacyKey = Buffer.alloc(32, 11);
    const keyStore = createKeyStore();
    writeFileSync(join(orbitDir, "master.key"), legacyKey.toString("base64"));
    const manager = new CredentialsManager({
      orbitDir,
      platform: "darwin",
      keyStore,
    });

    manager.storeSecret("DEEPSEEK_API_KEY", "secret");

    expect(keyStore.store).toHaveBeenCalledWith(legacyKey);
    expect(existsSync(join(orbitDir, "master.key"))).toBe(false);
    expect(manager.getSecret("DEEPSEEK_API_KEY")).toBe("secret");
  });

  it("keeps a legacy key usable when the native store is unavailable", () => {
    const legacyKey = Buffer.alloc(32, 12);
    const masterKeyPath = join(orbitDir, "master.key");
    writeFileSync(masterKeyPath, legacyKey.toString("base64"));
    const keyStore = createKeyStore();
    keyStore.store.mockImplementation(() => {
      throw new Error("native store unavailable");
    });
    const manager = new CredentialsManager({
      orbitDir,
      platform: "linux",
      keyStore,
    });

    manager.storeSecret("DEEPSEEK_API_KEY", "secret");

    expect(existsSync(masterKeyPath)).toBe(true);
    expect(manager.getSecret("DEEPSEEK_API_KEY")).toBe("secret");
  });

  it("purges encrypted files and the native platform key", () => {
    const keyStore = createKeyStore(Buffer.alloc(32, 13));
    const manager = new CredentialsManager({
      orbitDir,
      platform: "darwin",
      keyStore,
    });
    manager.storeSecret("DEEPSEEK_API_KEY", "secret");

    manager.purge();

    expect(keyStore.delete).toHaveBeenCalledOnce();
    expect(existsSync(join(orbitDir, "secrets.json"))).toBe(false);
    expect(manager.hasSecret("DEEPSEEK_API_KEY")).toBe(false);
  });
});

function createKeyStore(initialKey: Buffer | null = null) {
  let storedKey = initialKey;
  return {
    load: vi.fn(() => storedKey),
    store: vi.fn((key: Buffer) => {
      storedKey = key;
    }),
    delete: vi.fn(() => {
      storedKey = null;
    }),
  };
}
