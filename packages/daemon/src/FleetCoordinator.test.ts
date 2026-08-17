import { generateKeyPairSync } from "crypto";
import { describe, expect, it } from "vitest";
import { FleetCoordinator } from "./FleetCoordinator.js";
import { signFleetEnvelope, verifyFleetEnvelope } from "./FleetProtocol.js";

describe("FleetCoordinator", () => {
  it("enforces worker leases, patch ownership, and stale-worker rejection", () => {
    let now = new Date("2026-08-16T00:00:00.000Z");
    const coordinator = new FleetCoordinator({
      now: () => now,
      leaseMs: 10_000,
    });
    const submitted = coordinator.submit({
      originId: "desktop",
      workspaceRef: "ws:demo",
      prompt: "run checks",
      maxAttempts: 2,
    });
    const lease = coordinator.claim("worker-a");
    expect(lease?.id).toBe(submitted.id);
    expect(() =>
      coordinator.heartbeat(submitted.id, "worker-b", lease!.lease!.leaseId),
    ).toThrow("stale");
    expect(() =>
      coordinator.complete(submitted.id, "worker-a", lease!.lease!.leaseId, {
        state: "succeeded",
        patch: {
          baseRevision: "git:abc",
          digest: "a".repeat(64),
          files: ["src/main.ts"],
          ownership: { ownerId: "worker-b", scope: ["src/main.ts"] },
        },
      }),
    ).toThrow("ownership");
    now = new Date("2026-08-16T00:00:10.001Z");
    expect(() =>
      coordinator.complete(submitted.id, "worker-a", lease!.lease!.leaseId, {
        state: "succeeded",
      }),
    ).toThrow("expired");
    expect(coordinator.inspect(submitted.id)?.state).toBe("queued");
    const retry = coordinator.claim("worker-b");
    expect(retry?.attempt).toBe(2);
    const done = coordinator.complete(
      submitted.id,
      "worker-b",
      retry!.lease!.leaseId,
      { state: "succeeded" },
    );
    expect(done.state).toBe("succeeded");
  });

  it("signs and verifies an immutable job envelope", () => {
    const keys = generateKeyPairSync("ed25519");
    const envelope = signFleetEnvelope(
      { originId: "desktop", workspaceRef: "ws:demo", prompt: "hello" },
      "job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "control-plane",
      keys.privateKey.export({ format: "pem", type: "pkcs8" }),
    );
    expect(
      verifyFleetEnvelope(
        envelope,
        keys.publicKey.export({ format: "pem", type: "spki" }),
      ),
    ).toBe(true);
    expect(
      verifyFleetEnvelope(
        { ...envelope, job: { ...envelope.job, prompt: "tampered" } },
        keys.publicKey.export({ format: "pem", type: "spki" }),
      ),
    ).toBe(false);
  });

  it("keeps signed submission ids idempotent and rejects content reuse", () => {
    const coordinator = new FleetCoordinator();
    const id = "job_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
    const input = {
      originId: "desktop",
      workspaceRef: "ws:demo",
      prompt: "same request",
      maxAttempts: 2,
    };
    const first = coordinator.submit(input, id);
    expect(coordinator.submit(input, id)).toEqual(first);
    expect(() =>
      coordinator.submit({ ...input, prompt: "tampered" }, id),
    ).toThrow("different content");
  });
});
