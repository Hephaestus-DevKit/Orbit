import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  AcpRegistryFileSchema,
  buildAcpRegistrySignaturePayload,
  loadAcpRegistry,
  toTrustedExternalAgentConfig,
} from "./AcpRegistry.js";
import { fetchAcpRegistry } from "./AcpRegistryRemote.js";

describe("ACP local registry", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "orbit-acp-registry-cwd-"));
    home = mkdtempSync(join(tmpdir(), "orbit-acp-registry-home-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("merges user and project entries with project precedence", () => {
    const userPath = join(home, ".orbit", "acp");
    const projectPath = join(cwd, ".orbit", "acp");
    mkdirSync(userPath, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(
      join(userPath, "registry.json"),
      JSON.stringify({
        schemaVersion: 1,
        agents: [
          {
            id: "reviewer",
            title: "User reviewer",
            command: "user-agent",
            trust: "trusted",
          },
          {
            id: "planner",
            title: "Planner",
            command: "planner-agent",
          },
        ],
      }),
    );
    writeFileSync(
      join(projectPath, "registry.json"),
      JSON.stringify({
        schemaVersion: 1,
        agents: [
          {
            id: "reviewer",
            title: "Project reviewer",
            command: "project-agent",
          },
        ],
      }),
    );
    const snapshot = loadAcpRegistry(cwd, home);
    expect(snapshot.entries.map((item) => item.entry.id)).toEqual([
      "planner",
      "reviewer",
    ]);
    expect(
      snapshot.entries.find((item) => item.entry.id === "reviewer")?.entry
        .title,
    ).toBe("Project reviewer");
    expect(snapshot.diagnostics.every((item) => item.ok)).toBe(true);
  });

  it("reports malformed and symlinked registries without executing them", () => {
    const directory = join(home, ".orbit", "acp");
    mkdirSync(directory, { recursive: true });
    const source = join(home, "outside.json");
    writeFileSync(source, "{}");
    try {
      symlinkSync(source, join(directory, "registry.json"), "file");
    } catch {
      // Windows runners without developer mode cannot create links; retain a
      // malformed-file fallback so the diagnostics path is still exercised.
      writeFileSync(join(directory, "registry.json"), "{}");
    }
    const snapshot = loadAcpRegistry(cwd, home);
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.diagnostics[0]).toMatchObject({ scope: "user", ok: false });
  });

  it("requires explicit trust before converting a discovered entry", () => {
    const directory = join(cwd, ".orbit", "acp");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "registry.json"),
      JSON.stringify({
        schemaVersion: 1,
        agents: [
          {
            id: "trusted-agent",
            title: "Trusted",
            command: "agent",
            trust: "trusted",
          },
          {
            id: "untrusted-agent",
            title: "Untrusted",
            command: "agent",
          },
        ],
      }),
    );
    const snapshot = loadAcpRegistry(cwd, home);
    const trusted = snapshot.entries.find(
      (item) => item.entry.id === "trusted-agent",
    );
    const untrusted = snapshot.entries.find(
      (item) => item.entry.id === "untrusted-agent",
    );
    expect(toTrustedExternalAgentConfig(trusted!)).toMatchObject({
      command: "agent",
      permissionPolicy: "ask",
    });
    expect(() => toTrustedExternalAgentConfig(untrusted!)).toThrow(
      "not trusted",
    );
    expect(() =>
      toTrustedExternalAgentConfig(trusted!, { requireSignature: true }),
    ).toThrow("valid trusted signature");
  });

  it("verifies a signed registry against an Ed25519 trust root", () => {
    const directory = join(cwd, ".orbit", "acp");
    mkdirSync(directory, { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const unsigned = AcpRegistryFileSchema.parse({
      schemaVersion: 1,
      agents: [
        {
          id: "signed-agent",
          title: "Signed",
          command: "agent",
          trust: "trusted",
        },
      ],
    });
    const { payload } = buildAcpRegistrySignaturePayload(unsigned);
    writeFileSync(
      join(directory, "registry.json"),
      JSON.stringify({
        ...unsigned,
        signature: {
          algorithm: "ed25519",
          keyId: "release",
          value: sign(null, Buffer.from(payload, "utf8"), privateKey).toString(
            "base64",
          ),
        },
      }),
    );
    const unknownKey = loadAcpRegistry(cwd, home);
    expect(unknownKey.entries).toHaveLength(0);
    expect(unknownKey.diagnostics[0]).toMatchObject({
      ok: false,
      signatureStatus: "untrusted-key",
    });
    const snapshot = loadAcpRegistry(cwd, home, {
      trustRoots: {
        release: publicKey.export({ type: "spki", format: "pem" }).toString(),
      },
      requireSignature: true,
    });
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      signatureStatus: "valid",
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      toTrustedExternalAgentConfig(snapshot.entries[0], {
        requireSignature: true,
      }),
    ).toMatchObject({ command: "agent" });
  });

  it("rejects unsigned or tampered registries when signature trust is required", () => {
    const directory = join(cwd, ".orbit", "acp");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "registry.json"),
      JSON.stringify({
        schemaVersion: 1,
        agents: [{ id: "unsigned", title: "Unsigned", command: "agent" }],
      }),
    );
    const unsigned = loadAcpRegistry(cwd, home, { requireSignature: true });
    expect(unsigned.entries).toHaveLength(0);
    expect(unsigned.diagnostics[0]).toMatchObject({
      ok: false,
      signatureStatus: "unsigned",
    });
    expect(unsigned.diagnostics[0].error).toContain("valid trusted signature");

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const file = AcpRegistryFileSchema.parse({
      schemaVersion: 1,
      agents: [
        { id: "tampered", title: "Tampered", command: "original-agent" },
      ],
    });
    const { payload } = buildAcpRegistrySignaturePayload(file);
    writeFileSync(
      join(directory, "registry.json"),
      JSON.stringify({
        ...file,
        agents: [{ ...file.agents[0], command: "tampered-agent" }],
        signature: {
          algorithm: "ed25519",
          keyId: "release",
          value: sign(null, Buffer.from(payload, "utf8"), privateKey).toString(
            "base64",
          ),
        },
      }),
    );
    const tampered = loadAcpRegistry(cwd, home, {
      trustRoots: {
        release: publicKey.export({ type: "spki", format: "pem" }).toString(),
      },
    });
    expect(tampered.entries).toHaveLength(0);
    expect(tampered.diagnostics[0]).toMatchObject({
      ok: false,
      signatureStatus: "invalid",
    });
    expect(tampered.diagnostics[0].error).toContain("invalid");
  });

  it("verifies hosted provenance, signature, bounds, and conditional requests", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const file = AcpRegistryFileSchema.parse({
      schemaVersion: 1,
      metadata: {
        registryId: "official",
        owner: "Orbit Team",
        revision: 7,
        issuedAt: "2026-08-16T10:00:00.000Z",
        expiresAt: "2026-08-17T10:00:00.000Z",
      },
      agents: [
        {
          id: "reviewer",
          title: "Reviewer",
          command: "reviewer-agent",
          trust: "trusted",
        },
      ],
    });
    const { payload } = buildAcpRegistrySignaturePayload(file);
    const signed = {
      ...file,
      signature: {
        algorithm: "ed25519" as const,
        keyId: "release",
        value: sign(null, Buffer.from(payload, "utf8"), privateKey).toString(
          "base64",
        ),
      },
    };
    const root = publicKey.export({ type: "spki", format: "pem" }).toString();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(signed), {
          status: 200,
          headers: { "content-type": "application/json", etag: '"r7"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 304, headers: { etag: '"r7"' } }),
      );
    const options = {
      url: "https://registry.example.test/acp.json",
      trustRoots: { release: root },
      expectedRegistryId: "official",
      expectedOwner: "Orbit Team",
      now: () => new Date("2026-08-16T12:00:00.000Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    const first = await fetchAcpRegistry(options);
    expect(first).toMatchObject({
      signatureStatus: "valid",
      notModified: false,
      etag: '"r7"',
      metadata: { registryId: "official", revision: 7 },
    });
    const second = await fetchAcpRegistry({
      ...options,
      ifNoneMatch: first.etag,
      cachedFile: first.file,
    });
    expect(second).toMatchObject({
      notModified: true,
      signatureStatus: "valid",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://registry.example.test/acp.json",
      expect.objectContaining({
        headers: expect.objectContaining({ "If-None-Match": '"r7"' }),
      }),
    );
  });

  it("fails closed for unsigned, expired, oversized, and unsafe hosted registries", async () => {
    const base = {
      schemaVersion: 1 as const,
      metadata: {
        registryId: "official",
        owner: "Orbit Team",
        revision: 1,
        issuedAt: "2026-08-15T00:00:00.000Z",
        expiresAt: "2026-08-15T01:00:00.000Z",
      },
      agents: [],
    };
    const response = (value: unknown) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await expect(
      fetchAcpRegistry({
        url: "https://registry.example.test/acp.json",
        trustRoots: {},
        now: () => new Date("2026-08-16T00:00:00.000Z"),
        fetchImpl: vi
          .fn()
          .mockResolvedValue(response(base)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("expired");
    await expect(
      fetchAcpRegistry({
        url: "https://registry.example.test/acp.json",
        trustRoots: {},
        now: () => new Date("2026-08-15T00:30:00.000Z"),
        fetchImpl: vi.fn().mockResolvedValue(
          response({
            ...base,
            metadata: {
              ...base.metadata,
              expiresAt: "2026-08-17T00:00:00.000Z",
            },
          }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("signature");
    await expect(
      fetchAcpRegistry({
        url: "http://registry.example.test/acp.json",
        trustRoots: {},
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow("HTTPS");
    await expect(
      fetchAcpRegistry({
        url: "https://user:pass@registry.example.test/acp.json",
        trustRoots: {},
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow("credentials");
    await expect(
      fetchAcpRegistry({
        url: "https://registry.example.test/acp.json",
        trustRoots: {},
        maxBytes: 1_024,
        fetchImpl: vi.fn().mockResolvedValue(
          new Response("{".repeat(2_048), {
            status: 200,
            headers: { "content-length": "2048" },
          }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("exceeds");
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const abortedFetch = vi.fn((_url: string, init: RequestInit) => {
      expect(init.signal?.aborted).toBe(true);
      return Promise.reject(new Error("AbortError"));
    });
    await expect(
      fetchAcpRegistry({
        url: "https://registry.example.test/acp.json",
        trustRoots: {},
        signal: controller.signal,
        fetchImpl: abortedFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("AbortError");
  });
});
