import { randomBytes } from "crypto";
import { CredentialsManager } from "@orbit-build/config";

const CHECKPOINT_KEY_NAME = "ORBIT_CHECKPOINT_KEY";

/**
 * Load (or mint once) the 32-byte key encrypting checkpoint backups at rest.
 * The key lives in the encrypted credential store — DPAPI on Windows,
 * keychain/secret-tool or the 0600 master key elsewhere — so checkpoints
 * stop being the one plaintext copy of every file the agent ever edited.
 * Returns null when no credential store is usable; callers fall back to
 * plaintext rather than blocking edits.
 */
export function loadOrCreateCheckpointKey(
  credentials: CredentialsManager = new CredentialsManager(),
): Buffer | null {
  try {
    const existing = credentials.getSecret(CHECKPOINT_KEY_NAME);
    if (existing) {
      const key = Buffer.from(existing, "base64");
      if (key.length === 32) return key;
    }
    const key = randomBytes(32);
    credentials.storeSecret(CHECKPOINT_KEY_NAME, key.toString("base64"));
    return key;
  } catch {
    return null;
  }
}
