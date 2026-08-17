import { createPublicKey, verify as verifySignature } from "crypto";
import type { IncomingHttpHeaders } from "http";
import { z } from "zod";
import {
  DaemonIdentitySchema,
  DaemonScopeSchema,
  type DaemonIdentity,
  type DaemonScope,
} from "./DaemonProtocol.js";

const MAX_JWT_BYTES = 16 * 1024;
const DEFAULT_CLOCK_SKEW_SECONDS = 300;

const JwtKeySchema = z
  .object({
    kty: z.literal("RSA"),
    n: z.string().min(1).max(8_192),
    e: z.string().min(1).max(128),
    alg: z.literal("RS256").optional(),
    use: z.literal("sig").optional(),
  })
  .strict();

export const JwtDaemonAuthenticatorOptionsSchema = z
  .object({
    issuer: z.string().url().max(2_048),
    audience: z.string().trim().min(1).max(512),
    /** Offline JWKS keys. Refreshing keys is an application-owned concern. */
    keys: z.record(z.string().regex(/^[A-Za-z0-9._-]{1,128}$/), JwtKeySchema),
    scopeClaim: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)
      .default("scope"),
    roleClaim: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)
      .default("roles"),
    roleScopes: z
      .record(
        z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
        z.array(DaemonScopeSchema).min(1).max(4),
      )
      .default({}),
    subjectClaim: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)
      .default("sub"),
    clockSkewSeconds: z
      .number()
      .int()
      .min(0)
      .max(900)
      .default(DEFAULT_CLOCK_SKEW_SECONDS),
    requiredScopes: z.array(DaemonScopeSchema).max(4).default([]),
  })
  .strict();

export type JwtDaemonAuthenticatorOptions = z.input<
  typeof JwtDaemonAuthenticatorOptionsSchema
>;

export interface DaemonAuthenticator {
  readonly id: string;
  authenticate(
    headers: IncomingHttpHeaders,
  ): DaemonIdentity | undefined | Promise<DaemonIdentity | undefined>;
}

/**
 * Verify a short-lived RS256 bearer token against an administrator-supplied
 * offline JWKS. This is an identity adapter, not an OAuth login flow: key
 * rotation and obtaining the JWKS remain outside the daemon process.
 */
export class JwtDaemonAuthenticator implements DaemonAuthenticator {
  public readonly id = "jwt";
  private readonly options: z.output<
    typeof JwtDaemonAuthenticatorOptionsSchema
  >;

  public constructor(options: JwtDaemonAuthenticatorOptions) {
    this.options = JwtDaemonAuthenticatorOptionsSchema.parse(options);
  }

  public authenticate(
    headers: IncomingHttpHeaders,
  ): DaemonIdentity | undefined {
    const authorization = headers.authorization;
    const token =
      typeof authorization === "string"
        ? /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1]
        : undefined;
    if (!token || Buffer.byteLength(token, "utf8") > MAX_JWT_BYTES) {
      return undefined;
    }
    const parsed = verifyJwt(token, this.options);
    if (!parsed) return undefined;
    const scopes = resolveScopes(parsed.claims, this.options);
    if (
      scopes.length === 0 ||
      !this.options.requiredScopes.every((scope) => scopes.includes(scope))
    ) {
      return undefined;
    }
    const subject = parsed.claims[this.options.subjectClaim];
    if (
      typeof subject !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(subject)
    ) {
      return undefined;
    }
    return DaemonIdentitySchema.parse({
      id: `oidc:${subject}`.slice(0, 128),
      scopes,
      authMethod: this.id,
      issuer: this.options.issuer,
      keyId: parsed.keyId,
    });
  }
}

interface JwtClaims {
  [key: string]: unknown;
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
}

function verifyJwt(
  token: string,
  options: z.output<typeof JwtDaemonAuthenticatorOptionsSchema>,
): { claims: JwtClaims; keyId: string } | undefined {
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts.some((part) => part.length === 0 || part.length > MAX_JWT_BYTES)
  ) {
    return undefined;
  }
  let header: Record<string, unknown>;
  let claims: JwtClaims;
  try {
    header = parseJsonObject(decodeBase64Url(parts[0]));
    claims = parseJsonObject(decodeBase64Url(parts[1])) as JwtClaims;
  } catch {
    return undefined;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string")
    return undefined;
  const key = options.keys[header.kid];
  if (!key) return undefined;
  const issuer = claims.iss;
  if (
    issuer !== options.issuer ||
    !audienceMatches(claims.aud, options.audience)
  ) {
    return undefined;
  }
  const now = Math.floor(Date.now() / 1_000);
  const skew = options.clockSkewSeconds;
  if (!numericDateValid(claims.exp) || (claims.exp as number) < now - skew)
    return undefined;
  if (
    claims.nbf !== undefined &&
    (!numericDateValid(claims.nbf) || (claims.nbf as number) > now + skew)
  )
    return undefined;
  if (
    claims.iat !== undefined &&
    (!numericDateValid(claims.iat) || (claims.iat as number) > now + skew)
  )
    return undefined;
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, "ascii");
  const signature = decodeBase64Url(parts[2]);
  try {
    const valid = verifySignature(
      "RSA-SHA256",
      signingInput,
      createPublicKey({ key, format: "jwk" }),
      signature,
    );
    return valid ? { claims, keyId: header.kid } : undefined;
  } catch {
    return undefined;
  }
}

function resolveScopes(
  claims: JwtClaims,
  options: z.output<typeof JwtDaemonAuthenticatorOptionsSchema>,
): DaemonScope[] {
  const scopes = new Set<DaemonScope>();
  const rawScope = claims[options.scopeClaim];
  if (typeof rawScope === "string") {
    for (const value of rawScope.split(/\s+/)) addScope(scopes, value);
  } else if (Array.isArray(rawScope)) {
    for (const value of rawScope)
      if (typeof value === "string") addScope(scopes, value);
  }
  const rawRoles = claims[options.roleClaim];
  const roles =
    typeof rawRoles === "string"
      ? [rawRoles]
      : Array.isArray(rawRoles)
        ? rawRoles
        : [];
  for (const role of roles) {
    if (typeof role !== "string") continue;
    for (const scope of options.roleScopes[role] ?? []) scopes.add(scope);
  }
  const orderedScopes: DaemonScope[] = ["admin", "control", "submit", "read"];
  return orderedScopes.filter((scope) => scopes.has(scope));
}

function addScope(scopes: Set<DaemonScope>, value: string): void {
  const parsed = DaemonScopeSchema.safeParse(value);
  if (parsed.success) scopes.add(parsed.data);
}

function audienceMatches(value: unknown, expected: string): boolean {
  return (
    value === expected || (Array.isArray(value) && value.includes(expected))
  );
}

function numericDateValid(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 4_102_444_800
  );
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Invalid base64url segment.");
  const normalized = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(normalized, "base64");
}

function parseJsonObject(value: Buffer): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("JWT segment must be an object.");
  return parsed as Record<string, unknown>;
}
