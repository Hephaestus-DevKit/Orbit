import { generateKeyPairSync, randomBytes } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonAuditLog } from "./DaemonAudit.js";
import { FleetCoordinator } from "./FleetCoordinator.js";
import { FleetHttpClient } from "./FleetHttpClient.js";
import {
  FleetHttpServer,
  FleetHttpTokenAuthenticator,
} from "./FleetHttpServer.js";
import { signFleetEnvelope } from "./FleetProtocol.js";

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length > 0)
    rmSync(cleanup.pop()!, { recursive: true, force: true });
});

describe("Fleet HTTP transport", () => {
  it("rejects empty worker identity bindings", () => {
    expect(
      () =>
        new FleetHttpTokenAuthenticator([
          {
            id: "worker",
            token: randomBytes(32).toString("hex"),
            scopes: ["worker"],
            workerIds: [],
          },
        ]),
    ).toThrow(/at least 1/i);
  });

  it("submits signed jobs, claims leases, and enforces scopes", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-fleet-http-"));
    cleanup.push(root);
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ format: "pem", type: "spki" });
    const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" });
    const controllerToken = randomBytes(32).toString("hex");
    const workerToken = randomBytes(32).toString("hex");
    const server = new FleetHttpServer({
      coordinator: new FleetCoordinator({ leaseMs: 10_000 }),
      signerKeys: { controller: publicKey },
      authenticator: new FleetHttpTokenAuthenticator([
        {
          id: "controller",
          token: controllerToken,
          scopes: ["read", "submit", "control"],
        },
        { id: "worker", token: workerToken, scopes: ["read", "worker"] },
      ]),
      port: 0,
      auditLog: new DaemonAuditLog("audit/events.jsonl", root),
      requireAudit: true,
    });
    const address = await server.start();
    try {
      const controller = new FleetHttpClient({
        baseUrl: `${address.protocol}://${address.host}:${address.port}`,
        token: controllerToken,
      });
      const worker = new FleetHttpClient({
        baseUrl: `${address.protocol}://${address.host}:${address.port}`,
        token: workerToken,
      });
      const envelope = signFleetEnvelope(
        {
          originId: "desktop",
          workspaceRef: "ws:demo",
          prompt: "run checks",
          maxAttempts: 2,
        },
        "job_cccccccccccccccccccccccccccccccc",
        "controller",
        privateKey,
      );
      const submitted = await controller.submit(envelope);
      expect(submitted.id).toBe(envelope.jobId);
      expect((await controller.submit(envelope)).id).toBe(submitted.id);
      await expect(worker.submit(envelope)).rejects.toThrow(/scope|required/i);

      const claimed = await worker.claim("worker-a");
      expect(claimed?.lease?.workerId).toBe("worker-a");
      const leaseId = claimed!.lease!.leaseId;
      expect(
        (await worker.heartbeat(claimed!.id, "worker-a", leaseId)).state,
      ).toBe("leased");
      const completed = await worker.complete(claimed!.id, {
        workerId: "worker-a",
        leaseId,
        completion: {
          state: "succeeded",
          resultDigest: "d".repeat(64),
        },
      });
      expect(completed.state).toBe("succeeded");
      expect((await controller.health()).jobs).toBe(1);
      await expect(worker.cancel(completed.id)).rejects.toThrow(
        /scope|required/i,
      );
      expect((await controller.inspect(completed.id)).state).toBe("succeeded");
    } finally {
      await server.stop();
    }
  });

  it("rejects invalid signatures and insecure remote listeners", async () => {
    const keys = generateKeyPairSync("ed25519");
    const token = randomBytes(32).toString("hex");
    expect(
      () =>
        new FleetHttpClient({
          baseUrl: "ftp://127.0.0.1:1234",
          token,
        }),
    ).toThrow(/HTTPS|HTTP/i);
    const server = new FleetHttpServer({
      coordinator: new FleetCoordinator(),
      signerKeys: {
        controller: keys.publicKey.export({ format: "pem", type: "spki" }),
      },
      authenticator: new FleetHttpTokenAuthenticator([
        { id: "controller", token, scopes: ["admin"] },
      ]),
      port: 0,
    });
    const address = await server.start();
    try {
      const response = await fetch(
        `${address.protocol}://${address.host}:${address.port}/v1/jobs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            schemaVersion: 1,
            job: {
              originId: "desktop",
              workspaceRef: "ws:demo",
              prompt: "tampered",
              maxAttempts: 3,
            },
            jobId: "job_dddddddddddddddddddddddddddddddd",
            payloadDigest: "0".repeat(64),
            signerId: "controller",
            signature: "A".repeat(80),
          }),
        },
      );
      expect(response.status).toBe(403);
    } finally {
      await server.stop();
    }
    expect(
      () =>
        new FleetHttpServer({
          coordinator: new FleetCoordinator(),
          signerKeys: { controller: "unused" },
          authenticator: new FleetHttpTokenAuthenticator([
            { id: "controller", token, scopes: ["admin"] },
          ]),
          host: "192.0.2.10",
        }),
    ).toThrow(/TLS/i);
  });

  it("binds worker principals to declared worker identities", async () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-fleet-http-binding-"));
    cleanup.push(root);
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ format: "pem", type: "spki" });
    const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" });
    const controllerToken = randomBytes(32).toString("hex");
    const workerToken = randomBytes(32).toString("hex");
    const server = new FleetHttpServer({
      coordinator: new FleetCoordinator(),
      signerKeys: { controller: publicKey },
      authenticator: new FleetHttpTokenAuthenticator([
        { id: "controller", token: controllerToken, scopes: ["submit"] },
        {
          id: "worker-a",
          token: workerToken,
          scopes: ["worker"],
          workerIds: ["worker-a"],
        },
      ]),
      port: 0,
      auditLog: new DaemonAuditLog("audit/events.jsonl", root),
      requireAudit: true,
    });
    const address = await server.start();
    try {
      const controller = new FleetHttpClient({
        baseUrl: `${address.protocol}://${address.host}:${address.port}`,
        token: controllerToken,
      });
      const worker = new FleetHttpClient({
        baseUrl: `${address.protocol}://${address.host}:${address.port}`,
        token: workerToken,
      });
      const envelope = signFleetEnvelope(
        {
          originId: "desktop",
          workspaceRef: "ws:binding",
          prompt: "bound worker",
          maxAttempts: 1,
        },
        "job_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "controller",
        privateKey,
      );
      await controller.submit(envelope);
      await expect(worker.claim("worker-b")).rejects.toThrow(
        /worker identity/i,
      );
      expect((await worker.claim("worker-a"))?.lease?.workerId).toBe(
        "worker-a",
      );
    } finally {
      await server.stop();
    }
  });

  it("can fail closed for unbound worker principals", async () => {
    const token = randomBytes(32).toString("hex");
    const server = new FleetHttpServer({
      coordinator: new FleetCoordinator(),
      signerKeys: { controller: "unused" },
      authenticator: new FleetHttpTokenAuthenticator([
        { id: "worker", token, scopes: ["worker"] },
      ]),
      requireWorkerBinding: true,
      port: 0,
    });
    const address = await server.start();
    try {
      const response = await fetch(
        `${address.protocol}://${address.host}:${address.port}/v1/jobs/claim`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ workerId: "worker-a" }),
        },
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "worker_identity_forbidden" },
      });
    } finally {
      await server.stop();
    }
  });
});
