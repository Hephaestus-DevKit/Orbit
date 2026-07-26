import { execFileSync } from "child_process";
import { z } from "zod";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";

const EncodedCredentialKeySchema = z
  .string()
  .trim()
  .refine((value) => Buffer.from(value, "base64").length === 32);

export interface CredentialKeyStore {
  load(): Buffer | null;
  store(key: Buffer): void;
  delete(): void;
}

export type KeychainCommandRunner = (
  executable: string,
  args: string[],
) => string;

export interface MacOSKeychainKeyStoreOptions {
  service?: string;
  account?: string;
  run?: KeychainCommandRunner;
}

export type SecretServiceCommandRunner = (
  executable: string,
  args: string[],
  input?: string,
) => string;

export interface LinuxSecretServiceKeyStoreOptions {
  service?: string;
  account?: string;
  label?: string;
  run?: SecretServiceCommandRunner;
}

/** Store Orbit's encryption key in the current user's macOS Keychain. */
export class MacOSKeychainKeyStore implements CredentialKeyStore {
  private readonly service: string;
  private readonly account: string;
  private readonly run: KeychainCommandRunner;

  constructor(options: MacOSKeychainKeyStoreOptions = {}) {
    this.service = options.service ?? "dev.hephaestus.orbit.credentials";
    this.account = options.account ?? "master-key";
    this.run = options.run ?? runSecurityCommand;
  }

  public load(): Buffer | null {
    try {
      const encoded = EncodedCredentialKeySchema.parse(
        this.run("security", [
          "find-generic-password",
          "-a",
          this.account,
          "-s",
          this.service,
          "-w",
        ]),
      );
      return Buffer.from(encoded, "base64");
    } catch (error) {
      if (isMissingKeychainItem(error)) return null;
      throw new Error("Unable to read the Orbit credential key from Keychain.");
    }
  }

  public store(key: Buffer): void {
    if (key.length !== 32) {
      throw new Error("Credential key must contain exactly 32 bytes.");
    }
    this.run("security", [
      "add-generic-password",
      "-U",
      "-a",
      this.account,
      "-s",
      this.service,
      "-w",
      key.toString("base64"),
    ]);
  }

  public delete(): void {
    try {
      this.run("security", [
        "delete-generic-password",
        "-a",
        this.account,
        "-s",
        this.service,
      ]);
    } catch (error) {
      if (!isMissingKeychainItem(error)) {
        throw new Error(
          "Unable to remove the Orbit credential key from Keychain.",
        );
      }
    }
  }
}

/** Store Orbit's encryption key through the freedesktop Secret Service CLI. */
export class LinuxSecretServiceKeyStore implements CredentialKeyStore {
  private readonly service: string;
  private readonly account: string;
  private readonly label: string;
  private readonly run: SecretServiceCommandRunner;

  constructor(options: LinuxSecretServiceKeyStoreOptions = {}) {
    this.service = options.service ?? "dev.hephaestus.orbit.credentials";
    this.account = options.account ?? "master-key";
    this.label = options.label ?? "Orbit credential encryption key";
    this.run = options.run ?? runSecretServiceCommand;
  }

  public load(): Buffer | null {
    let encoded: string;
    try {
      encoded = this.run("secret-tool", [
        "lookup",
        "service",
        this.service,
        "account",
        this.account,
      ]);
    } catch (error: unknown) {
      if (isUnavailableSecretService(error)) return null;
      throw new Error(
        "Unable to read the Orbit credential key from Secret Service.",
      );
    }
    if (!encoded.trim()) return null;
    try {
      return Buffer.from(EncodedCredentialKeySchema.parse(encoded), "base64");
    } catch (error: unknown) {
      throw new Error(
        "The Orbit credential key in Secret Service is invalid.",
        {
          cause: error,
        },
      );
    }
  }

  public store(key: Buffer): void {
    if (key.length !== 32) {
      throw new Error("Credential key must contain exactly 32 bytes.");
    }
    this.run(
      "secret-tool",
      [
        "store",
        `--label=${this.label}`,
        "service",
        this.service,
        "account",
        this.account,
      ],
      `${key.toString("base64")}\n`,
    );
  }

  public delete(): void {
    try {
      this.run("secret-tool", [
        "clear",
        "service",
        this.service,
        "account",
        this.account,
      ]);
    } catch (error: unknown) {
      if (!isUnavailableSecretService(error)) {
        throw new Error(
          "Unable to remove the Orbit credential key from Secret Service.",
        );
      }
    }
  }
}

function runSecurityCommand(executable: string, args: string[]): string {
  return execFileSync(executable, args, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function runSecretServiceCommand(
  executable: string,
  args: string[],
  input?: string,
): string {
  return execFileSync(executable, args, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
  });
}

function isMissingKeychainItem(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("status" in error && error.status === 44) ||
      ("code" in error && error.code === "ENOENT"))
  );
}

function isUnavailableSecretService(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && error.code === "ENOENT") ||
      ("status" in error && (error.status === 1 || error.status === 2)))
  );
}
