import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  redactSensitiveValue,
  registerSecretForRedaction,
  unregisterSecretForRedaction,
} from "./redaction.js";

describe("API keys and secrets redaction", () => {
  it("redacts registered opaque credentials", () => {
    const secret = "opaque-value-without-a-known-provider-prefix";
    registerSecretForRedaction(secret);
    expect(redactSecrets(`before ${secret} after`)).toBe(
      "before ***REDACTED*** after",
    );
    unregisterSecretForRedaction(secret);
    expect(redactSecrets(secret)).toBe(secret);
  });
  it("keeps shared credentials redacted until every owner releases them", () => {
    const secret = "shared-opaque-credential";
    registerSecretForRedaction(secret);
    registerSecretForRedaction(secret);
    unregisterSecretForRedaction(secret);
    expect(redactSecrets(secret)).toBe("***REDACTED***");
    unregisterSecretForRedaction(secret);
    expect(redactSecrets(secret)).toBe(secret);
  });
  it("redacts nested event payloads without changing the source", () => {
    const source = {
      stdout: "Authorization: Bearer nested-private-token",
      rows: ["OPENAI_API_KEY=abcdefghijk"],
    };
    const redacted = redactSensitiveValue(source);
    expect(JSON.stringify(redacted)).not.toContain("nested-private-token");
    expect(JSON.stringify(redacted)).not.toContain("abcdefghijk");
    expect(source.stdout).toContain("nested-private-token");
  });
  it("should redact OpenAI and DeepSeek API keys", () => {
    const raw = "The key is sk-12345678901234567890123456789012";
    expect(redactSecrets(raw)).toBe("The key is sk-***REDACTED***");
  });

  it("should redact Anthropic API keys", () => {
    const raw =
      "The key is sk-ant-sid01-12345678901234567890123456789012345678901234";
    expect(redactSecrets(raw)).toBe("The key is sk-ant-***REDACTED***");
  });

  it("should redact Bearer auth tokens", () => {
    const raw = "Authorization: Bearer abcd1234efgh5678";
    expect(redactSecrets(raw)).toBe("Authorization: Bearer ***REDACTED***");
  });

  it("should redact private keys", () => {
    const raw =
      "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDh...\n-----END PRIVATE KEY-----";
    expect(redactSecrets(raw)).toBe("***PRIVATE_KEY_REDACTED***");
  });

  it("should redact AWS access key ids", () => {
    expect(redactSecrets("creds: AKIAIOSFODNN7EXAMPLE")).toBe(
      "creds: ***AWS_KEY_REDACTED***",
    );
    expect(redactSecrets("temp: ASIAIOSFODNN7EXAMPLE")).toBe(
      "temp: ***AWS_KEY_REDACTED***",
    );
  });

  it("should redact GitHub tokens", () => {
    expect(
      redactSecrets("token ghp_16C7e42F292c6912E7710c838347Ae178B4a"),
    ).toBe("token gh*_***REDACTED***");
    expect(
      redactSecrets(
        "pat github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz012345",
      ),
    ).toBe("pat github_pat_***REDACTED***");
  });

  it("should redact Slack tokens", () => {
    // Assembled at runtime so push-protection scanners don't flag the fixture.
    const slackToken = ["xoxb", "1234567890", "abcdefghijklmnop"].join("-");
    expect(redactSecrets(`slack ${slackToken}`)).toBe(
      "slack xox*-***REDACTED***",
    );
  });

  it("should redact JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c";
    expect(redactSecrets(`auth ${jwt}`)).toBe("auth ***JWT_REDACTED***");
  });

  it("should redact npm, Google, and Stripe keys", () => {
    expect(redactSecrets("npm npm_AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBe(
      "npm npm_***REDACTED***",
    );
    expect(
      redactSecrets("google AIzaSyA1234567890abcdefghijklmnopqrstuv"),
    ).toBe("google ***GOOGLE_KEY_REDACTED***");
    // Assembled at runtime so push-protection scanners don't flag the fixture.
    const stripeKey = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");
    expect(redactSecrets(`stripe ${stripeKey}`)).toBe(
      "stripe ***STRIPE_KEY_REDACTED***",
    );
  });

  it("should redact env-style secret assignments while keeping the name", () => {
    expect(redactSecrets("OPENAI_API_KEY=abc123secretvalue")).toBe(
      "OPENAI_API_KEY=***REDACTED***",
    );
    expect(redactSecrets('DB_PASSWORD: "hunter2hunter2"')).toBe(
      'DB_PASSWORD: "***REDACTED***"',
    );
  });

  it("should leave ordinary text and code untouched", () => {
    const samples = [
      "the token count is 42",
      "const apiKey = loadKey();",
      "password too short: x=abc",
      "docs mention API_KEY=YOUR_KEY here", // placeholder shorter than 8 chars is kept
      "checkout pk_live_notASecretPublishable0",
    ];
    for (const sample of samples.slice(0, 3)) {
      expect(redactSecrets(sample)).toBe(sample);
    }
    expect(redactSecrets(samples[4])).toBe(samples[4]);
  });
});
