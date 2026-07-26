import picocolors from "picocolors";
import { ConfigLoader } from "@orbit-build/config";
import { createMcpTokenStore, runMcpPkceLogin } from "@orbit-build/mcp";

export interface McpLoginOptions {
  cwd?: string;
  port?: number;
}

/**
 * Interactive OAuth login for one configured MCP server (authorization-code
 * flow with PKCE). Persists the refresh token in the encrypted credential
 * store; the runtime client then refreshes access tokens silently.
 */
export async function runMcpLogin(
  serverName: string,
  options: McpLoginOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const config = ConfigLoader.loadSync(cwd);
  const serverConfig = config.mcpServers?.[serverName];
  if (!serverConfig) {
    console.error(
      picocolors.red(
        `✖ Unknown MCP server "${serverName}". Configure it under mcpServers first.`,
      ),
    );
    return 1;
  }
  const oauth = serverConfig.oauth;
  if (!oauth || oauth.mode !== "authorization_code") {
    console.error(
      picocolors.red(
        `✖ MCP server "${serverName}" is not configured for authorization_code OAuth. ` +
          `Set mcpServers.${serverName}.oauth.mode to "authorization_code" and provide authorizationUrl.`,
      ),
    );
    return 1;
  }

  try {
    const result = await runMcpPkceLogin({
      serverName,
      oauth,
      redirectPort: options.port,
      onAuthorizationUrl: (url) => {
        console.log("");
        console.log("Open this URL in your browser to authorize Orbit:");
        console.log("");
        console.log(`  ${url}`);
        console.log("");
        console.log("Waiting for the redirect on 127.0.0.1 …");
      },
    });
    if (!result.refreshToken) {
      console.error(
        picocolors.yellow(
          "⚠ The authorization server returned no refresh token. " +
            "Access will expire and require another login; ask the server " +
            "operator to enable refresh tokens (offline_access scope).",
        ),
      );
      return 1;
    }
    await createMcpTokenStore(serverName).setRefreshToken(result.refreshToken);
    console.log(
      picocolors.green(
        `✔ Login for MCP server "${serverName}" saved. Tokens refresh automatically from now on.`,
      ),
    );
    return 0;
  } catch (error: unknown) {
    console.error(
      picocolors.red(
        `✖ MCP login failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return 1;
  }
}
