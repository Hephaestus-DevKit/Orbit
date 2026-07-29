import { CredentialsManager } from "@orbit-build/config";
import { createHash } from "node:crypto";
import type { McpOAuthTokenStore } from "./StreamableHttpMCPClient.js";

function legacyMcpRefreshTokenKey(serverName: string): string {
  const normalized = serverName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 100);
  return `MCP_REFRESH_${normalized}`;
}

/**
 * Derive the encrypted-credential key holding one server's OAuth refresh
 * token. Must satisfy the credential-store key pattern
 * `^[A-Za-z_][A-Za-z0-9_]{0,127}$` for any configured server name.
 */
export function mcpRefreshTokenKey(serverName: string): string {
  const readable =
    serverName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 80) || "SERVER";
  const digest = createHash("sha256").update(serverName, "utf8").digest("hex");
  return `MCP_REFRESH_${readable}_${digest.slice(0, 16)}`;
}

/**
 * Persist MCP OAuth refresh tokens in the encrypted credential store
 * (DPAPI on Windows, keychain or AES-GCM master key elsewhere).
 */
export function createMcpTokenStore(
  serverName: string,
  credentials: CredentialsManager = new CredentialsManager(),
): McpOAuthTokenStore {
  const key = mcpRefreshTokenKey(serverName);
  const legacyKey = legacyMcpRefreshTokenKey(serverName);
  const legacyKeyIsUnambiguous =
    serverName.length <= 100 && /^[A-Za-z0-9_]+$/.test(serverName);
  return {
    async getRefreshToken(): Promise<string | undefined> {
      const current = credentials.getSecret(key);
      if (current !== null) return current;

      if (!legacyKeyIsUnambiguous) return undefined;
      const legacy = credentials.getSecret(legacyKey);
      if (legacy === null) return undefined;

      try {
        credentials.storeSecret(key, legacy);
        credentials.deleteSecret(legacyKey);
      } catch {
        // Migration is best-effort. A readable legacy token remains usable
        // even when the secure store is temporarily unavailable for writes.
      }
      return legacy;
    },
    async setRefreshToken(token: string): Promise<void> {
      credentials.storeSecret(key, token);
    },
  };
}
