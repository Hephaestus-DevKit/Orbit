import { execFileSync } from "child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import crypto from "crypto";
import { z } from "zod";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";
import {
  LinuxSecretServiceKeyStore,
  MacOSKeychainKeyStore,
  type CredentialKeyStore,
} from "./CredentialKeyStore.js";

const CredentialKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/)
  .refine(
    (value) =>
      value !== "__proto__" && value !== "constructor" && value !== "prototype",
  );
const CredentialValueSchema = z
  .string()
  .min(1)
  .max(16384)
  .refine((value) => !/[\r\n]/.test(value));
const SecretsFileSchema = z.record(CredentialKeySchema, z.string());
const EncryptedSecretSchema = z.object({
  iv: z.string().regex(/^[0-9a-f]{24}$/i),
  encrypted: z.string().regex(/^[0-9a-f]*$/i),
  tag: z.string().regex(/^[0-9a-f]{32}$/i),
});

function windowsPowerShellEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };

  // A Node process launched from PowerShell 7 inherits its module path. Passing
  // that path to Windows PowerShell 5 can make it select an incompatible
  // Microsoft.PowerShell.Security module before its own inbox module.
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === "psmodulepath") {
      delete environment[key];
    }
  }

  return environment;
}

export interface CredentialsManagerOptions {
  orbitDir?: string;
  platform?: NodeJS.Platform;
  fallbackKey?: Buffer;
  keyStore?: CredentialKeyStore | null;
}

export class CredentialsManager {
  private readonly orbitDir: string;
  private readonly secretsPath: string;
  private readonly masterKeyPath: string;
  private readonly isWindows: boolean;
  private readonly keyStore: CredentialKeyStore | null;
  private fallbackKey?: Buffer;

  constructor(options: CredentialsManagerOptions = {}) {
    this.orbitDir = options.orbitDir ?? join(homedir(), ".orbit");
    this.secretsPath = join(this.orbitDir, "secrets.json");
    this.masterKeyPath = join(this.orbitDir, "master.key");
    const platform = options.platform ?? process.platform;
    this.isWindows = platform === "win32";
    this.keyStore =
      options.keyStore === undefined
        ? platform === "darwin"
          ? new MacOSKeychainKeyStore()
          : platform === "linux"
            ? new LinuxSecretServiceKeyStore()
            : null
        : options.keyStore;
    this.fallbackKey = options.fallbackKey;
  }

  /**
   * Store a secret value securely under the given key.
   */
  public storeSecret(key: string, value: string): void {
    const validatedKey = CredentialKeySchema.parse(key);
    const validatedValue = CredentialValueSchema.parse(value);
    const secrets = this.loadSecretsFile();
    const encrypted = this.isWindows
      ? this.encryptWindows(validatedValue)
      : this.encryptFallback(validatedValue);

    secrets[validatedKey] = encrypted;
    this.saveSecretsFile(secrets);
  }

  /**
   * Retrieve a securely stored secret value.
   */
  public getSecret(key: string): string | null {
    const validatedKey = CredentialKeySchema.safeParse(key);
    if (!validatedKey.success) return null;
    const secrets = this.loadSecretsFile();
    const encrypted = secrets[validatedKey.data];
    if (!encrypted) return null;

    try {
      return this.isWindows
        ? this.decryptWindows(encrypted)
        : this.decryptFallback(encrypted);
    } catch {
      return null;
    }
  }

  /** Remove a securely stored secret without exposing its previous value. */
  public deleteSecret(key: string): boolean {
    const validatedKey = CredentialKeySchema.safeParse(key);
    if (!validatedKey.success) return false;
    const secrets = this.loadSecretsFile();
    if (!Object.prototype.hasOwnProperty.call(secrets, validatedKey.data)) {
      return false;
    }
    delete secrets[validatedKey.data];
    this.saveSecretsFile(secrets);
    return true;
  }

  /** Report whether a named secret exists without decrypting it. */
  public hasSecret(key: string): boolean {
    const validatedKey = CredentialKeySchema.safeParse(key);
    if (!validatedKey.success) return false;
    return Object.prototype.hasOwnProperty.call(
      this.loadSecretsFile(),
      validatedKey.data,
    );
  }

  /** Remove encrypted credentials and their platform key without revealing data. */
  public purge(): void {
    this.keyStore?.delete();
    this.removeFileIfPresent(this.secretsPath);
    this.removeFileIfPresent(this.masterKeyPath);
    this.fallbackKey = undefined;
  }

  private loadSecretsFile(): Record<string, string> {
    if (!existsSync(this.secretsPath)) {
      return {};
    }
    try {
      const raw = readFileSync(this.secretsPath, "utf8");
      const parsed = SecretsFileSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  private saveSecretsFile(secrets: Record<string, string>): void {
    this.ensureOrbitDir();
    const temporaryPath = `${this.secretsPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(secrets, null, 2), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temporaryPath, this.secretsPath);
      this.restrictFilePermissions(this.secretsPath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The temporary file may not have been created.
      }
      throw error;
    }
  }

  // Windows DPAPI Encryption using PowerShell over stdin
  private encryptWindows(plainText: string): string {
    try {
      const script =
        "$plain = [Console]::In.ReadLine(); if ($plain) { $plain | ConvertTo-SecureString -AsPlainText -Force -ErrorAction Stop | ConvertFrom-SecureString -ErrorAction Stop }";
      const stdout = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          ...HIDDEN_CHILD_PROCESS_OPTIONS,
          input: plainText + "\n",
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
          env: windowsPowerShellEnvironment(),
        },
      );
      return stdout.trim();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Windows encryption failed: ${message}`);
    }
  }

  // Windows DPAPI Decryption using PowerShell over stdin
  private decryptWindows(cipherText: string): string {
    try {
      const script =
        "$cipher = [Console]::In.ReadLine(); if ($cipher) { $secure = ConvertTo-SecureString $cipher -ErrorAction Stop; $pointer = [IntPtr]::Zero; try { $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { if ($pointer -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) } } }";
      const stdout = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          ...HIDDEN_CHILD_PROCESS_OPTIONS,
          input: cipherText + "\n",
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
          env: windowsPowerShellEnvironment(),
        },
      );
      return stdout.trim();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Windows decryption failed: ${message}`);
    }
  }

  // Fallback platform-independent AES encryption
  private encryptFallback(plainText: string): string {
    const iv = crypto.randomBytes(12);
    const key = this.getFallbackKey();
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    return JSON.stringify({
      iv: iv.toString("hex"),
      encrypted,
      tag: authTag,
    });
  }

  // Fallback platform-independent AES decryption
  private decryptFallback(cipherText: string): string {
    const parsed = EncryptedSecretSchema.parse(JSON.parse(cipherText));
    const { iv, encrypted, tag } = parsed;
    const key = this.getFallbackKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex"),
    );

    decipher.setAuthTag(Buffer.from(tag, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  private ensureOrbitDir(): void {
    mkdirSync(this.orbitDir, { recursive: true, mode: 0o700 });
    if (!this.isWindows) {
      chmodSync(this.orbitDir, 0o700);
    }
  }

  private getFallbackKey(): Buffer {
    if (this.fallbackKey) {
      if (this.fallbackKey.length !== 32) {
        throw new Error(
          "Fallback credential key must contain exactly 32 bytes.",
        );
      }
      return this.fallbackKey;
    }

    const platformKey = this.keyStore?.load();
    if (platformKey) {
      this.fallbackKey = this.validateFallbackKey(platformKey);
      return this.fallbackKey;
    }

    const legacyKey = this.readMasterKeyFile();
    if (legacyKey) {
      if (this.keyStore) {
        try {
          this.keyStore.store(legacyKey);
          this.removeFileIfPresent(this.masterKeyPath);
        } catch {
          // Keep the restricted legacy key when the native store is temporarily
          // unavailable. A later run can retry migration without data loss.
        }
      }
      this.fallbackKey = legacyKey;
      return legacyKey;
    }

    const generated = crypto.randomBytes(32);
    if (this.keyStore) {
      try {
        this.keyStore.store(generated);
        this.fallbackKey = generated;
        return generated;
      } catch {
        // Preserve a functional encrypted fallback if Keychain is unavailable.
      }
    }

    this.ensureOrbitDir();
    writeFileSync(this.masterKeyPath, generated.toString("base64"), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    this.restrictFilePermissions(this.masterKeyPath);
    this.fallbackKey = generated;
    return generated;
  }

  private readMasterKeyFile(): Buffer | null {
    if (!existsSync(this.masterKeyPath)) return null;
    return this.validateFallbackKey(
      Buffer.from(readFileSync(this.masterKeyPath, "utf8"), "base64"),
    );
  }

  private validateFallbackKey(key: Buffer): Buffer {
    if (key.length !== 32) {
      throw new Error("Credential master key is invalid.");
    }
    return key;
  }

  private removeFileIfPresent(filePath: string): void {
    try {
      unlinkSync(filePath);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }

  private restrictFilePermissions(filePath: string): void {
    if (this.isWindows) return;
    chmodSync(filePath, 0o600);
  }
}
