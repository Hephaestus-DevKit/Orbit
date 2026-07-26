const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\bsk-[a-zA-Z0-9]{32,}\b/g,
    replacement: "sk-***REDACTED***",
  },
  {
    pattern: /\bsk-ant-[a-z0-9]+-[a-zA-Z0-9_\-]{40,}\b/gi,
    replacement: "sk-ant-***REDACTED***",
  },
  {
    pattern: /Bearer\s+([a-zA-Z0-9_\-\.~+\/]+=*)/gi,
    replacement: "Bearer ***REDACTED***",
  },
  {
    pattern: /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g,
    replacement: "***PRIVATE_KEY_REDACTED***",
  },
  {
    pattern: /(mongodb(?:\+srv)?:\/\/[a-zA-Z0-9_.-]+:)([^@]+)(@)/g,
    replacement: "$1***REDACTED***$3",
  },
  {
    // AWS access key ids (permanent AKIA / temporary ASIA).
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: "***AWS_KEY_REDACTED***",
  },
  {
    // GitHub personal/OAuth/server/refresh tokens and fine-grained PATs.
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replacement: "gh*_***REDACTED***",
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    replacement: "github_pat_***REDACTED***",
  },
  {
    // Slack bot/app/user/legacy tokens.
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: "xox*-***REDACTED***",
  },
  {
    // Three-part JWTs (header always decodes from "eyJ").
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: "***JWT_REDACTED***",
  },
  {
    pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g,
    replacement: "npm_***REDACTED***",
  },
  {
    // Google API keys.
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: "***GOOGLE_KEY_REDACTED***",
  },
  {
    // Stripe secret/restricted keys (publishable pk_ keys are not secrets).
    pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    replacement: "***STRIPE_KEY_REDACTED***",
  },
  {
    // Env-style assignments: API_KEY=..., MY_SERVICE_TOKEN: "...".
    // Uppercase variable names only, to avoid rewriting ordinary prose/code.
    pattern:
      /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)[^\s"']{8,}\3/g,
    replacement: "$1$2$3***REDACTED***$3",
  },
];

export function redactSecrets(text: string): string {
  if (!text) return text;
  let redacted = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}
