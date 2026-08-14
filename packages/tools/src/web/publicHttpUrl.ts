import { lookup } from "dns/promises";
import { isIP } from "net";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import { readResponseJsonWithinLimit } from "@orbit-build/shared";

export type AddressResolver = (
  hostname: string,
  signal?: AbortSignal,
) => Promise<string[]>;

export interface PublicHttpTarget {
  url: string;
  hostname: string;
  addresses: readonly string[];
}

export interface HttpTargetOptions {
  /** Permit loopback, private, link-local, and other non-public destinations. */
  allowPrivateNetwork?: boolean;
}

const MAX_RESOLVED_ADDRESSES = 64;

const DnsJsonResponseSchema = z.object({
  Status: z.number(),
  Answer: z
    .array(
      z.object({
        type: z.number(),
        data: z.string().max(1024),
      }),
    )
    .max(1000)
    .optional(),
});

const PUBLIC_DNS_ENDPOINTS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

/** Resolve addresses through the operating system's active DNS path. */
export async function resolveSystemAddresses(
  hostname: string,
  signal?: AbortSignal,
  lookupImplementation: typeof lookup = lookup,
): Promise<string[]> {
  if (signal?.aborted) throw abortError("System DNS lookup was cancelled.");

  return new Promise<string[]>((resolve, reject) => {
    const onAbort = () =>
      reject(abortError("System DNS lookup was cancelled."));
    signal?.addEventListener("abort", onAbort, { once: true });
    lookupImplementation(hostname, { all: true, verbatim: true })
      .then((entries) => resolve(entries.map((entry) => entry.address)))
      .catch(reject)
      .finally(() => signal?.removeEventListener("abort", onAbort));
  });
}

/**
 * Resolve a hostname through authenticated public DNS-over-HTTPS.
 *
 * This is used only when a local proxy exposes public sites through RFC 2544
 * synthetic addresses. It preserves the public-host check without treating a
 * proxy Fake-IP as the destination network.
 */
export function createPublicDnsResolver(
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): AddressResolver {
  return async (hostname, parentSignal) => {
    const failures: string[] = [];
    for (const endpoint of PUBLIC_DNS_ENDPOINTS) {
      try {
        const addresses = await queryDnsEndpoint(
          endpoint,
          hostname,
          fetchImplementation,
          parentSignal,
        );
        if (addresses.length > 0) return addresses;
        failures.push(`${new URL(endpoint).hostname}: no address records`);
      } catch (error: unknown) {
        failures.push(
          `${new URL(endpoint).hostname}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    throw new Error(`Public DNS verification failed (${failures.join("; ")}).`);
  };
}

/** Validate and normalize a public HTTP(S) URL before a network request. */
export async function assertPublicHttpUrl(
  rawUrl: string,
  resolveAddresses: AddressResolver = resolveSystemAddresses,
  resolvePublicAddresses: AddressResolver = createPublicDnsResolver(),
  signal?: AbortSignal,
): Promise<string> {
  return (
    await resolvePublicHttpTarget(
      rawUrl,
      resolveAddresses,
      resolvePublicAddresses,
      signal,
    )
  ).url;
}

/**
 * Validate a public HTTP(S) URL and return the exact addresses approved for
 * its next connection. Callers must pin the request to these addresses so a
 * second DNS lookup cannot change the destination after validation.
 */
export async function resolvePublicHttpTarget(
  rawUrl: string,
  resolveAddresses: AddressResolver = resolveSystemAddresses,
  resolvePublicAddresses: AddressResolver = createPublicDnsResolver(),
  signal?: AbortSignal,
): Promise<PublicHttpTarget> {
  return resolveHttpTarget(
    rawUrl,
    resolveAddresses,
    resolvePublicAddresses,
    signal,
  );
}

/** Resolve and pin an HTTP(S) target under an explicit network scope. */
export async function resolveHttpTarget(
  rawUrl: string,
  resolveAddresses: AddressResolver = resolveSystemAddresses,
  resolvePublicAddresses: AddressResolver = createPublicDnsResolver(),
  signal?: AbortSignal,
  options: HttpTargetOptions = {},
): Promise<PublicHttpTarget> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !options.allowPrivateNetwork &&
    (hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".home.arpa"))
  ) {
    throw new Error("Local and private network URLs are blocked.");
  }
  if (
    !options.allowPrivateNetwork &&
    isIP(hostname) > 0 &&
    isPrivateOrReservedAddress(hostname)
  ) {
    throw new Error(
      "Local, private, or reserved network addresses are blocked.",
    );
  }

  const addresses = normalizeResolvedAddresses(
    await resolveAddresses(hostname, signal),
    "The URL hostname",
  );
  if (addresses.length === 0) {
    throw new Error("The URL hostname did not resolve to an address.");
  }

  const syntheticAddresses = addresses.filter(isSyntheticProxyAddress);
  if (!options.allowPrivateNetwork && syntheticAddresses.length > 0) {
    if (syntheticAddresses.length !== addresses.length) {
      throw new Error(
        "The URL hostname resolved to a mixture of public and reserved addresses.",
      );
    }
    const publicAddresses = normalizeResolvedAddresses(
      await resolvePublicAddresses(hostname, signal),
      "Public DNS verification",
    );
    if (
      publicAddresses.length === 0 ||
      publicAddresses.some(isPrivateOrReservedAddress)
    ) {
      throw new Error(
        "The proxy-mapped hostname could not be verified as a public destination.",
      );
    }
  } else if (
    !options.allowPrivateNetwork &&
    addresses.some(isPrivateOrReservedAddress)
  ) {
    throw new Error(
      "Local, private, or reserved network addresses are blocked.",
    );
  }

  url.hash = "";
  return { url: url.toString(), hostname, addresses };
}

async function queryDnsEndpoint(
  endpoint: string,
  hostname: string,
  fetchImplementation: typeof globalThis.fetch,
  parentSignal?: AbortSignal,
): Promise<string[]> {
  const addresses: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    const url = new URL(endpoint);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", type);
    const timeoutSignal = AbortSignal.timeout(3_000);
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, timeoutSignal])
      : timeoutSignal;
    const response = await fetchImplementation(url, {
      headers: { Accept: "application/dns-json" },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${response.status}`);
    }
    const parsed = DnsJsonResponseSchema.parse(
      await readResponseJsonWithinLimit(response, 64 * 1024, "DNS response"),
    );
    if (parsed.Status !== 0) {
      throw new Error(`DNS status ${parsed.Status}`);
    }
    for (const answer of parsed.Answer || []) {
      if ((answer.type === 1 || answer.type === 28) && isIP(answer.data) > 0) {
        addresses.push(answer.data);
      }
    }
  }
  return Array.from(new Set(addresses));
}

function isSyntheticProxyAddress(address: string): boolean {
  const parts = address.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts.every(Number.isInteger) &&
    parts[0] === 198 &&
    (parts[1] === 18 || parts[1] === 19)
  );
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function normalizeResolvedAddresses(
  addresses: readonly string[],
  source: string,
): string[] {
  if (addresses.length > MAX_RESOLVED_ADDRESSES) {
    throw new Error(
      `${source} returned too many addresses (maximum ${MAX_RESOLVED_ADDRESSES}).`,
    );
  }
  const normalized = Array.from(
    new Set(
      addresses.map((address) =>
        address
          .trim()
          .toLowerCase()
          .replace(/^\[|\]$/g, ""),
      ),
    ),
  );
  if (normalized.some((address) => isIP(address) === 0)) {
    throw new Error(`${source} returned an invalid IP address.`);
  }
  return normalized;
}

function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (!ipaddr.isValid(normalized)) {
    return true;
  }
  return ipaddr.parse(normalized).range() !== "unicast";
}
