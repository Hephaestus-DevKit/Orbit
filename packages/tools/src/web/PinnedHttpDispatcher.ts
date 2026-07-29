import type { LookupFunction } from "net";
import { isIP } from "net";
import { Agent, type Dispatcher } from "undici";

export interface PinnedDispatcherLease {
  dispatcher: Dispatcher;
  close(): Promise<void>;
}

export type PinnedDispatcherFactory = (
  hostname: string,
  addresses: readonly string[],
) => PinnedDispatcherLease;

/**
 * Create a request-scoped dispatcher whose DNS lookup can only return the
 * addresses approved by the SSRF validator.
 */
export const createPinnedDispatcher: PinnedDispatcherFactory = (
  hostname,
  addresses,
) => {
  const lookup = createPinnedLookup(hostname, addresses);
  const agent = new Agent({
    connect: {
      lookup,
      autoSelectFamily: addresses.length > 1,
    },
  });
  return {
    dispatcher: agent,
    close: () => agent.close(),
  };
};

export function createPinnedLookup(
  expectedHostname: string,
  addresses: readonly string[],
): LookupFunction {
  const records = addresses.map((address) => {
    const family = isIP(address);
    if (family !== 4 && family !== 6) {
      throw new Error(`Cannot pin an invalid IP address: ${address}`);
    }
    return { address, family };
  });
  if (records.length === 0) {
    throw new Error("Cannot create a pinned connection without an IP address.");
  }

  let cursor = 0;
  return (hostname, options, callback) => {
    if (hostname.toLowerCase() !== expectedHostname.toLowerCase()) {
      const error = new Error(
        `Pinned DNS lookup rejected unexpected hostname: ${hostname}`,
      ) as NodeJS.ErrnoException;
      error.code = "EAI_NONAME";
      callback(error, []);
      return;
    }

    const requestedFamily =
      options.family === "IPv4"
        ? 4
        : options.family === "IPv6"
          ? 6
          : options.family;
    const matching =
      requestedFamily === 4 || requestedFamily === 6
        ? records.filter((record) => record.family === requestedFamily)
        : records;
    if (matching.length === 0) {
      const error = new Error(
        `Pinned DNS lookup has no IPv${String(requestedFamily)} address.`,
      ) as NodeJS.ErrnoException;
      error.code = "EAI_ADDRFAMILY";
      callback(error, []);
      return;
    }
    if (options.all) {
      callback(null, matching);
      return;
    }
    const selected = matching[cursor % matching.length];
    cursor += 1;
    callback(null, selected.address, selected.family);
  };
}
