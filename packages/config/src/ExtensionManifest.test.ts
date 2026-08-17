import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { generateKeyPairSync, sign } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadOrbitExtensionManifest,
  OrbitExtensionManifestSchema,
  verifyOrbitExtensionSignature,
} from "./ExtensionManifest.js";
import { canonicalJsonStringify } from "@orbit-build/shared";

describe("Orbit extension manifest", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-extension-"));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("validates versioned contributions and explicit permissions", () => {
    const manifest = OrbitExtensionManifestSchema.parse({
      schemaVersion: 1,
      id: "com.example.review",
      displayName: "Review tools",
      version: "1.2.3",
      orbit: { minVersion: "0.1.7" },
      permissions: {
        filesystem: [{ mode: "read", scope: "src" }],
      },
      contributes: {
        commands: [{ name: "review", path: "commands/review.md" }],
        skills: [{ name: "security", path: "skills/security/SKILL.md" }],
      },
    });

    expect(manifest.permissions.process).toBe(false);
    expect(manifest.contributes.commands[0].name).toBe("review");
  });

  it("loads YAML inside the workspace and rejects escaping paths", () => {
    writeFileSync(
      join(cwd, "extension.yaml"),
      [
        "schemaVersion: 1",
        "id: com.example.safe",
        "displayName: Safe extension",
        "version: 1.0.0",
        "orbit:",
        "  minVersion: 0.1.7",
      ].join("\n"),
      "utf8",
    );
    expect(loadOrbitExtensionManifest(cwd, "extension.yaml").id).toBe(
      "com.example.safe",
    );
    expect(() => loadOrbitExtensionManifest(cwd, "../extension.yaml")).toThrow(
      "outside workspace boundary",
    );
    expect(() =>
      OrbitExtensionManifestSchema.parse({
        schemaVersion: 1,
        id: "com.example.unsafe",
        displayName: "Unsafe",
        version: "1.0.0",
        orbit: { minVersion: "0.1.7" },
        contributes: {
          commands: [{ name: "escape", path: "../escape.md" }],
        },
      }),
    ).toThrow("inside the extension directory");
  });

  it("verifies an Ed25519 trust-root signature over the manifest and tree digest", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const unsigned = OrbitExtensionManifestSchema.parse({
      schemaVersion: 1,
      id: "com.example.signed",
      displayName: "Signed extension",
      version: "1.0.0",
      orbit: { minVersion: "0.1.7" },
    });
    const digest = "a".repeat(64);
    const payload = canonicalJsonStringify({ manifest: unsigned, digest });
    const value = sign(null, Buffer.from(payload), privateKey).toString(
      "base64",
    );
    const signedManifest = OrbitExtensionManifestSchema.parse({
      ...unsigned,
      signature: { algorithm: "ed25519", keyId: "release", value },
    });
    const root = publicKey.export({ type: "spki", format: "pem" }).toString();

    expect(
      verifyOrbitExtensionSignature(signedManifest, digest, { release: root }),
    ).toBe(true);
    expect(
      verifyOrbitExtensionSignature(signedManifest, "b".repeat(64), {
        release: root,
      }),
    ).toBe(false);
  });
});
