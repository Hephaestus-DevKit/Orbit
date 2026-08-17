import { generateKeyPairSync, sign } from "crypto";
import { describe, expect, it } from "vitest";
import { JwtDaemonAuthenticator } from "./DaemonIdentity.js";

function createToken(
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "key-1", typ: "JWT" },
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode(header)}.${encode(claims)}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), privateKey).toString(
    "base64url",
  );
  return `${input}.${signature}`;
}

describe("JwtDaemonAuthenticator", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = keys.publicKey.export({ format: "jwk" });

  it("verifies issuer, audience, time, signature, and mapped scopes", () => {
    const authenticator = new JwtDaemonAuthenticator({
      issuer: "https://issuer.example.test",
      audience: "orbit-daemon",
      keys: { "key-1": { ...jwk, kty: "RSA" } },
      roleScopes: { operator: ["read", "submit", "control"] },
    });
    const now = Math.floor(Date.now() / 1_000);
    const token = createToken(keys.privateKey, {
      iss: "https://issuer.example.test",
      aud: ["other", "orbit-daemon"],
      sub: "alice@example.test",
      exp: now + 60,
      nbf: now - 1,
      roles: ["operator"],
    });
    const identity = authenticator.authenticate({
      authorization: `Bearer ${token}`,
    });
    expect(identity).toMatchObject({
      id: "oidc:alice@example.test",
      authMethod: "jwt",
      scopes: ["control", "submit", "read"],
      keyId: "key-1",
    });
  });

  it("fails closed for expired, wrong-audience, unsigned, and insufficient-scope tokens", () => {
    const authenticator = new JwtDaemonAuthenticator({
      issuer: "https://issuer.example.test",
      audience: "orbit-daemon",
      keys: { "key-1": { ...jwk, kty: "RSA" } },
      requiredScopes: ["admin"],
    });
    const now = Math.floor(Date.now() / 1_000);
    const base = {
      iss: "https://issuer.example.test",
      sub: "alice",
      exp: now - 600,
      scope: "read",
    };
    expect(
      authenticator.authenticate({
        authorization: `Bearer ${createToken(keys.privateKey, base)}`,
      }),
    ).toBeUndefined();
    expect(
      authenticator.authenticate({
        authorization: `Bearer ${createToken(keys.privateKey, { ...base, exp: now + 60, aud: "wrong" })}`,
      }),
    ).toBeUndefined();
    expect(
      authenticator.authenticate({
        authorization: `Bearer ${createToken(keys.privateKey, { ...base, exp: now + 60 }, { alg: "none", kid: "key-1" })}`,
      }),
    ).toBeUndefined();
  });
});
