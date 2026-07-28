import { lookup } from "dns/promises";
import { isIP } from "net";
import ipaddr from "ipaddr.js";
import { z } from "zod";

export type AddressResolver = (
  hostname: string,
  signal?: AbortSignal,
) => Promise<string[]>;

const DnsJsonResponseSchema = z.object({
  Status: z.number(),
  Answer: z
    .array(
      z.object({
        type: z.number(),
        data: z.string(),
      }),
    )
    .optional(),
});

const PUBLIC_DNS_ENDPOINTS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

/** Resolve addresses through the operating system's active DNS path. */
export async function resolveSystemAddresses(
  hostname: string,
): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  );
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
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new Error("Local and private network URLs are blocked.");
  }
  if (isIP(hostname) > 0 && isPrivateOrReservedAddress(hostname)) {
    throw new Error(
      "Local, private, or reserved network addresses are blocked.",
    );
  }

  const addresses = await resolveAddresses(hostname, signal);
  if (addresses.length === 0) {
    throw new Error("The URL hostname did not resolve to an address.");
  }

  const syntheticAddresses = addresses.filter(isSyntheticProxyAddress);
  if (syntheticAddresses.length > 0) {
    if (syntheticAddresses.length !== addresses.length) {
      throw new Error(
        "The URL hostname resolved to a mixture of public and reserved addresses.",
      );
    }
    const publicAddresses = await resolvePublicAddresses(hostname, signal);
    if (
      publicAddresses.length === 0 ||
      publicAddresses.some(isPrivateOrReservedAddress)
    ) {
      throw new Error(
        "The proxy-mapped hostname could not be verified as a public destination.",
      );
    }
  } else if (addresses.some(isPrivateOrReservedAddress)) {
    throw new Error(
      "Local, private, or reserved network addresses are blocked.",
    );
  }

  url.hash = "";
  return url.toString();
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
      throw new Error(`HTTP ${response.status}`);
    }
    const parsed = DnsJsonResponseSchema.parse(await response.json());
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

function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (!ipaddr.isValid(normalized)) {
    return true;
  }
  return ipaddr.parse(normalized).range() !== "unicast";
}
