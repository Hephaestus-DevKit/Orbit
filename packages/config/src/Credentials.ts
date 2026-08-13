import { execFileSync } from "child_process";
import { chmodSync, closeSync, openSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import crypto from "crypto";
import { z } from "zod";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  buildSanitizedChildEnvironment,
  ensurePrivateDirectory,
  readBoundedRegularFile,
  registerSecretForRedaction,
  replacePrivateFileAtomically,
  unregisterSecretForRedaction,
} from "@orbit-build/shared";
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
const MAX_SECRETS_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MASTER_KEY_FILE_BYTES = 1024;

function windowsPowerShellEnvironment(): NodeJS.ProcessEnv {
  return buildSanitizedChildEnvironment({ mode: "minimal" });
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
  private readonly mutationLockPath: string;
  private readonly isWindows: boolean;
  private readonly keyStore: CredentialKeyStore | null;
  private fallbackKey?: Buffer;
  private readonly registeredSecrets = new Set<string>();

  constructor(options: CredentialsManagerOptions = {}) {
    this.orbitDir = options.orbitDir ?? join(homedir(), ".orbit");
    this.secretsPath = join(this.orbitDir, "secrets.json");
    this.masterKeyPath = join(this.orbitDir, "master.key");
    this.mutationLockPath = join(this.orbitDir, "secrets.lock");
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
    const previous = this.withMutationLock(() => {
      const secrets = this.loadSecretsFile();
      const previousValue = secrets[validatedKey]
        ? this.decryptStoredSecret(secrets[validatedKey])
        : null;
      const encrypted = this.isWindows
        ? this.encryptWindows(validatedValue)
        : this.encryptFallback(validatedValue);

      secrets[validatedKey] = encrypted;
      this.saveSecretsFile(secrets);
      return previousValue;
    });
    if (previous && previous !== validatedValue) this.forgetSecret(previous);
    this.rememberSecret(validatedValue);
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
      const value = this.isWindows
        ? this.decryptWindows(encrypted)
        : this.decryptFallback(encrypted);
      this.rememberSecret(value);
      return value;
    } catch {
      return null;
    }
  }

  /** Remove a securely stored secret without exposing its previous value. */
  public deleteSecret(key: string): boolean {
    const validatedKey = CredentialKeySchema.safeParse(key);
    if (!validatedKey.success) return false;
    return this.withMutationLock(() => {
      const secrets = this.loadSecretsFile();
      if (!Object.prototype.hasOwnProperty.call(secrets, validatedKey.data)) {
        return false;
      }
      const previous = this.decryptStoredSecret(secrets[validatedKey.data]);
      delete secrets[validatedKey.data];
      this.saveSecretsFile(secrets);
      if (previous) this.forgetSecret(previous);
      return true;
    });
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
    this.withMutationLock(() => {
      this.keyStore?.delete();
      this.removeFileIfPresent(this.secretsPath);
      this.removeFileIfPresent(this.masterKeyPath);
    });
    for (const secret of this.registeredSecrets) {
      unregisterSecretForRedaction(secret);
    }
    this.registeredSecrets.clear();
    this.fallbackKey?.fill(0);
    this.fallbackKey = undefined;
  }

  private loadSecretsFile(): Record<string, string> {
    try {
      const raw = readBoundedRegularFile(
        this.secretsPath,
        MAX_SECRETS_FILE_BYTES,
      );
      if (raw === undefined) return {};
      const parsed = SecretsFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error("Credential store has an invalid schema.");
      }
      return parsed.data;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Orbit credential store is unreadable; it was preserved and will not be overwritten. Repair or restore ${this.secretsPath}. ${detail}`,
        { cause: error },
      );
    }
  }

  private saveSecretsFile(secrets: Record<string, string>): void {
    this.ensureOrbitDir();
    replacePrivateFileAtomically(
      this.secretsPath,
      `${JSON.stringify(secrets, null, 2)}\n`,
    );
    this.restrictFilePermissions(this.secretsPath);
  }

  private withMutationLock<T>(operation: () => T, retried = false): T {
    this.ensureOrbitDir();
    let descriptor: number;
    try {
      descriptor = openSync(this.mutationLockPath, "wx", 0o600);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        if (!retried && this.removeStaleMutationLock()) {
          return this.withMutationLock(operation, true);
        }
        throw new Error(
          "Orbit credential store is busy in another process. Retry after that credential operation completes.",
          { cause: error },
        );
      }
      throw error;
    }
    try {
      writeFileSync(
        descriptor,
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      return operation();
    } finally {
      try {
        closeSync(descriptor);
      } finally {
        this.removeFileIfPresent(this.mutationLockPath);
      }
    }
  }

  private removeStaleMutationLock(): boolean {
    try {
      const raw = readBoundedRegularFile(this.mutationLockPath, 4096);
      if (raw === undefined) return true;
      const payload = z
        .object({
          pid: z.number().int().positive(),
          createdAt: z.string().datetime(),
        })
        .parse(JSON.parse(raw));
      let processAlive = true;
      try {
        process.kill(payload.pid, 0);
      } catch (error: unknown) {
        processAlive = !(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ESRCH"
        );
      }
      if (processAlive) return false;
      this.removeFileIfPresent(this.mutationLockPath);
      return true;
    } catch {
      return false;
    }
  }

  private decryptStoredSecret(encrypted: string): string | null {
    try {
      return this.isWindows
        ? this.decryptWindows(encrypted)
        : this.decryptFallback(encrypted);
    } catch {
      return null;
    }
  }

  private rememberSecret(secret: string): void {
    const normalized = secret.trim();
    if (normalized.length < 6 || this.registeredSecrets.has(normalized)) return;
    registerSecretForRedaction(normalized);
    this.registeredSecrets.add(normalized);
  }

  private forgetSecret(secret: string): void {
    unregisterSecretForRedaction(secret);
    this.registeredSecrets.delete(secret.trim());
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
    ensurePrivateDirectory(this.orbitDir, {
      platform: this.isWindows ? "win32" : "linux",
      windowsAcl: false,
    });
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
    try {
      writeFileSync(this.masterKeyPath, generated.toString("base64"), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        generated.fill(0);
        const concurrentKey = this.readMasterKeyFile();
        if (concurrentKey) {
          this.fallbackKey = concurrentKey;
          return concurrentKey;
        }
      }
      generated.fill(0);
      throw error;
    }
    this.restrictFilePermissions(this.masterKeyPath);
    this.fallbackKey = generated;
    return generated;
  }

  private readMasterKeyFile(): Buffer | null {
    const raw = readBoundedRegularFile(
      this.masterKeyPath,
      MAX_MASTER_KEY_FILE_BYTES,
    );
    if (raw === undefined) return null;
    return this.validateFallbackKey(Buffer.from(raw, "base64"));
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
