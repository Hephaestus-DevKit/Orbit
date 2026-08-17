import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
import {
  AcpRegistryFileSchema,
  AcpRegistryMetadataSchema,
  buildAcpRegistrySignaturePayload,
  verifyAcpRegistrySignature,
  type AcpRegistryFile,
  type AcpRegistryMetadata,
  type AcpRegistrySignatureStatus,
} from "./AcpRegistry.js";

const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_ALLOWED_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface AcpRemoteRegistryFetchOptions {
  /** Hosted registries must use HTTPS and cannot carry userinfo. */
  url: string;
  trustRoots: Record<string, string>;
  expectedRegistryId?: string;
  expectedOwner?: string;
  /** Remote registries are signed-only by default. */
  requireSignature?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /** Conditional request state held by the caller, not persisted implicitly. */
  ifNoneMatch?: string;
  cachedFile?: AcpRegistryFile;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface AcpRemoteRegistryFetchResult {
  url: string;
  file: AcpRegistryFile;
  metadata: AcpRegistryMetadata;
  digest: string;
  signatureStatus: AcpRegistrySignatureStatus;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

/**
 * Fetch and verify one hosted ACP registry without granting it execution
 * authority. The caller still decides whether an entry is trusted and when
 * to atomically persist the verified document.
 */
export async function fetchAcpRegistry(
  options: AcpRemoteRegistryFetchOptions,
): Promise<AcpRemoteRegistryFetchResult> {
  const url = normalizeHostedRegistryUrl(options.url);
  const trustRoots = options.trustRoots ?? {};
  const timeoutMs = z
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .parse(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = z
    .number()
    .int()
    .min(1_024)
    .max(MAX_ALLOWED_BYTES)
    .parse(options.maxBytes ?? DEFAULT_MAX_BYTES);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new Error(`ACP registry request timed out after ${timeoutMs}ms.`),
    );
  }, timeoutMs);
  timer.unref();
  const relayAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", relayAbort, { once: true });

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.ifNoneMatch
          ? { "If-None-Match": boundHeader(options.ifNoneMatch) }
          : {}),
      },
    });
    const etag = readResponseHeader(response, "etag");
    const lastModified = readResponseHeader(response, "last-modified");
    if (response.status === 304) {
      if (!options.cachedFile) {
        throw new Error("ACP registry returned 304 without a cached document.");
      }
      return verifyHostedRegistry(options.cachedFile, {
        url,
        trustRoots,
        expectedRegistryId: options.expectedRegistryId,
        expectedOwner: options.expectedOwner,
        requireSignature: options.requireSignature ?? true,
        now: options.now,
        etag,
        lastModified,
        notModified: true,
      });
    }
    if (!response.ok) {
      throw new Error(`Hosted ACP registry returned HTTP ${response.status}.`);
    }
    const raw = await readBoundedJson(response, maxBytes);
    const parsed = AcpRegistryFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Hosted ACP registry schema is invalid: ${parsed.error.issues
          .slice(0, 4)
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }
    return verifyHostedRegistry(parsed.data, {
      url,
      trustRoots,
      expectedRegistryId: options.expectedRegistryId,
      expectedOwner: options.expectedOwner,
      requireSignature: options.requireSignature ?? true,
      now: options.now,
      etag,
      lastModified,
      notModified: false,
    });
  } catch (error: unknown) {
    const message = redactSecrets(
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(
      `Hosted ACP registry fetch failed: ${message.slice(0, 2_000)}`,
      {
        cause: error,
      },
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relayAbort);
  }
}

interface VerifyHostedRegistryOptions {
  url: string;
  trustRoots: Record<string, string>;
  expectedRegistryId?: string;
  expectedOwner?: string;
  requireSignature: boolean;
  now?: () => Date;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

function verifyHostedRegistry(
  file: AcpRegistryFile,
  options: VerifyHostedRegistryOptions,
): AcpRemoteRegistryFetchResult {
  const metadata = AcpRegistryMetadataSchema.parse(file.metadata);
  if (
    options.expectedRegistryId &&
    metadata.registryId !== options.expectedRegistryId
  ) {
    throw new Error(
      `Hosted ACP registry id mismatch: expected ${options.expectedRegistryId}.`,
    );
  }
  if (options.expectedOwner && metadata.owner !== options.expectedOwner) {
    throw new Error("Hosted ACP registry owner mismatch.");
  }
  const now = (options.now ?? (() => new Date()))().getTime();
  const issuedAt = Date.parse(metadata.issuedAt);
  if (!Number.isFinite(issuedAt) || issuedAt > now + CLOCK_SKEW_MS) {
    throw new Error(
      "Hosted ACP registry issuedAt is outside the allowed clock skew.",
    );
  }
  if (metadata.expiresAt && Date.parse(metadata.expiresAt) <= now) {
    throw new Error("Hosted ACP registry has expired.");
  }
  const signatureStatus = getSignatureStatus(file, options.trustRoots);
  if (signatureStatus !== "valid" && options.requireSignature) {
    throw new Error(
      `Hosted ACP registry signature is ${signatureStatus}; a valid trusted signature is required.`,
    );
  }
  const { digest } = buildAcpRegistrySignaturePayload(file);
  return {
    url: options.url,
    file,
    metadata,
    digest,
    signatureStatus,
    ...(options.etag ? { etag: options.etag } : {}),
    ...(options.lastModified ? { lastModified: options.lastModified } : {}),
    notModified: options.notModified,
  };
}

function getSignatureStatus(
  file: AcpRegistryFile,
  trustRoots: Record<string, string>,
): AcpRegistrySignatureStatus {
  if (!file.signature) return "unsigned";
  if (!trustRoots[file.signature.keyId]) return "untrusted-key";
  return verifyAcpRegistrySignature(file, trustRoots) ? "valid" : "invalid";
}

function normalizeHostedRegistryUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Hosted ACP registry URL is invalid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Hosted ACP registry URL must use HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error(
      "Hosted ACP registry URL cannot contain credentials or a fragment.",
    );
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed.toString();
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Hosted ACP registry exceeds the ${maxBytes}-byte limit.`);
  }
  if (!response.body)
    throw new Error("Hosted ACP registry response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(
          `Hosted ACP registry exceeds the ${maxBytes}-byte limit.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    throw new Error("Hosted ACP registry returned invalid JSON.");
  }
}

function readResponseHeader(
  response: Response,
  name: string,
): string | undefined {
  const value = response.headers.get(name)?.trim();
  return value ? boundHeader(value) : undefined;
}

function boundHeader(value: string): string {
  return redactSecrets(value)
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .slice(0, 512);
}
