import { randomBytes } from "crypto";
import { z } from "zod";
import { redactSecrets } from "@orbit-build/shared";
import {
  createFleetJobId,
  FleetJobIdSchema,
  FleetJobRecordSchema,
  FleetJobSubmitSchema,
  FleetWorkerIdSchema,
  type FleetJobId,
  type FleetJobRecord,
  type FleetJobSubmit,
  type FleetPatch,
  type FleetWorkerId,
} from "./FleetProtocol.js";

const LEASE_MS = 60_000;
const MAX_JOBS = 10_000;

export interface FleetCoordinatorPersistence {
  load(): FleetJobRecord[];
  save(records: FleetJobRecord[]): void;
}

export interface FleetCoordinatorOptions {
  persistence?: FleetCoordinatorPersistence;
  leaseMs?: number;
  now?: () => Date;
}

export interface FleetCompletion {
  state: "succeeded" | "failed";
  resultDigest?: string;
  patch?: FleetPatch;
  error?: string;
}

/**
 * Provider-neutral scheduler for cloud/offload hosts.
 *
 * It owns assignment leases and patch ownership, but deliberately does not
 * open sockets or assume a cloud vendor. A hosted adapter can persist these
 * records behind a transactional database while retaining the same stale
 * worker and rollback semantics.
 */
export class FleetCoordinator {
  private readonly records = new Map<FleetJobId, FleetJobRecord>();
  private readonly persistence?: FleetCoordinatorPersistence;
  private readonly leaseMs: number;
  private readonly now: () => Date;

  public constructor(options: FleetCoordinatorOptions = {}) {
    this.persistence = options.persistence;
    this.leaseMs = Math.max(
      10_000,
      Math.min(options.leaseMs ?? LEASE_MS, 15 * 60_000),
    );
    this.now = options.now ?? (() => new Date());
    for (const record of options.persistence?.load() ?? []) {
      const parsed = FleetJobRecordSchema.parse(record);
      this.records.set(parsed.id, parsed);
    }
  }

  public submit(
    input: FleetJobSubmit,
    requestedId?: FleetJobId,
  ): FleetJobRecord {
    this.recoverExpired();
    if (this.records.size >= MAX_JOBS)
      throw new Error(`Fleet job retention limit reached (${MAX_JOBS}).`);
    const parsed = FleetJobSubmitSchema.parse(input);
    const id = requestedId
      ? FleetJobIdSchema.parse(requestedId)
      : createFleetJobId(randomBytes(16));
    const existing = this.records.get(id);
    if (existing) {
      if (
        existing.originId === parsed.originId &&
        existing.workspaceRef === parsed.workspaceRef &&
        existing.prompt === parsed.prompt &&
        existing.maxAttempts === parsed.maxAttempts
      ) {
        return existing;
      }
      throw new Error(
        `Fleet job id already exists with different content: ${id}`,
      );
    }
    const timestamp = this.now().toISOString();
    const record = FleetJobRecordSchema.parse({
      schemaVersion: 1,
      id,
      originId: parsed.originId,
      workspaceRef: parsed.workspaceRef,
      prompt: parsed.prompt,
      state: "queued",
      attempt: 1,
      maxAttempts: parsed.maxAttempts,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.records.set(record.id, record);
    this.persist();
    return record;
  }

  public list(limit = 100): FleetJobRecord[] {
    this.recoverExpired();
    return [...this.records.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(1, Math.min(limit, MAX_JOBS)));
  }

  public inspect(id: FleetJobId): FleetJobRecord | undefined {
    this.recoverExpired();
    return this.records.get(id);
  }

  public claim(workerId: FleetWorkerId): FleetJobRecord | undefined {
    const worker = FleetWorkerIdSchema.parse(workerId);
    this.recoverExpired();
    const next = [...this.records.values()]
      .filter((record) => record.state === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!next) return undefined;
    const leaseId = `lease_${randomBytes(16).toString("hex")}`;
    const updated = this.update(next, {
      state: "leased",
      lease: {
        workerId: worker,
        leaseId,
        expiresAt: new Date(this.now().getTime() + this.leaseMs).toISOString(),
      },
    });
    return updated;
  }

  public heartbeat(
    id: FleetJobId,
    workerId: FleetWorkerId,
    leaseId: string,
  ): FleetJobRecord {
    const record = this.requireLease(id, workerId, leaseId);
    return this.update(record, {
      lease: {
        ...record.lease!,
        expiresAt: new Date(this.now().getTime() + this.leaseMs).toISOString(),
      },
    });
  }

  public complete(
    id: FleetJobId,
    workerId: FleetWorkerId,
    leaseId: string,
    completion: FleetCompletion,
  ): FleetJobRecord {
    const record = this.requireLease(id, workerId, leaseId);
    if (
      completion.state === "succeeded" &&
      completion.patch &&
      completion.patch.ownership.ownerId !== workerId
    ) {
      throw new Error(
        "Fleet patch ownership does not belong to the completing worker.",
      );
    }
    const resultDigest = completion.resultDigest;
    if (resultDigest !== undefined && !/^[a-f0-9]{64}$/.test(resultDigest))
      throw new Error("Fleet result digest is invalid.");
    return this.update(record, {
      state: completion.state,
      lease: undefined,
      ...(completion.patch ? { patch: completion.patch } : {}),
      ...(resultDigest ? { resultDigest } : {}),
      ...(completion.error
        ? { error: redactSecrets(completion.error).slice(0, 4_000) }
        : {}),
    });
  }

  public cancel(id: FleetJobId): FleetJobRecord {
    const record = this.require(id);
    if (["succeeded", "failed", "canceled", "expired"].includes(record.state))
      return record;
    return this.update(record, {
      state: "canceled",
      lease: undefined,
      error: "Canceled by an authenticated fleet controller.",
    });
  }

  public recoverExpired(at = this.now()): FleetJobRecord[] {
    const recovered: FleetJobRecord[] = [];
    for (const record of this.records.values()) {
      if (
        record.state !== "leased" ||
        !record.lease ||
        new Date(record.lease.expiresAt).getTime() > at.getTime()
      )
        continue;
      const updated =
        record.attempt >= record.maxAttempts
          ? this.update(record, {
              state: "expired",
              lease: undefined,
              error:
                "Fleet worker lease expired and retry budget was exhausted.",
            })
          : this.update(record, {
              state: "queued",
              attempt: record.attempt + 1,
              lease: undefined,
              error: "Previous fleet worker lease expired; job requeued.",
            });
      recovered.push(updated);
    }
    return recovered;
  }

  private require(id: FleetJobId): FleetJobRecord {
    const parsed = z.string().parse(id) as FleetJobId;
    const record = this.records.get(parsed);
    if (!record) throw new Error(`Fleet job not found: ${id}`);
    return record;
  }

  private requireLease(
    id: FleetJobId,
    workerId: FleetWorkerId,
    leaseId: string,
  ): FleetJobRecord {
    const record = this.require(id);
    if (
      record.state !== "leased" ||
      !record.lease ||
      record.lease.workerId !== workerId ||
      record.lease.leaseId !== leaseId
    ) {
      throw new Error("Fleet job lease is stale or belongs to another worker.");
    }
    if (new Date(record.lease.expiresAt).getTime() <= this.now().getTime()) {
      this.recoverExpired();
      throw new Error("Fleet job lease has expired.");
    }
    return record;
  }

  private update(
    record: FleetJobRecord,
    patch: Partial<FleetJobRecord>,
  ): FleetJobRecord {
    const updated = FleetJobRecordSchema.parse({
      ...record,
      ...patch,
      updatedAt: this.now().toISOString(),
    });
    this.records.set(updated.id, updated);
    this.persist();
    return updated;
  }

  private persist(): void {
    this.persistence?.save([...this.records.values()]);
  }
}
