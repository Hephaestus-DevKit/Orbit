import { CredentialsManager } from "@orbit-build/config";
import type { McpOAuthTokenStore } from "./StreamableHttpMCPClient.js";

/**
 * Derive the encrypted-credential key holding one server's OAuth refresh
 * token. Must satisfy the credential-store key pattern
 * `^[A-Za-z_][A-Za-z0-9_]{0,127}$` for any configured server name.
 */
export function mcpRefreshTokenKey(serverName: string): string {
  const normalized = serverName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 100);
  return `MCP_REFRESH_${normalized}`;
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
  return {
    async getRefreshToken(): Promise<string | undefined> {
      return credentials.getSecret(key) ?? undefined;
    },
    async setRefreshToken(token: string): Promise<void> {
      credentials.storeSecret(key, token);
    },
  };
}
