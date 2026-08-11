import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { basename, join, resolve } from "path";
import { z } from "zod";
import {
  generateId,
  readBoundedRegularFile,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";
import { SessionIdSchema } from "./types.js";

const AGENT_RUN_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_AGENT_RUN_LEASE_MS = 30_000;
const AGENT_RUN_LOCK_RETRIES = 50;
const AGENT_RUN_LOCK_WAIT_MS = 10;
const AGENT_RUN_STALE_LOCK_MS = 10_000;
const AGENT_RUN_LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));

const AgentIdSchema = z
  .string()
  .regex(/^agent_[a-z0-9-]+$/, "Invalid agent id.");
const AgentRunIdSchema = z
  .string()
  .regex(/^run_[a-z0-9-]+$/, "Invalid agent run id.");
const AgentRunOwnerSchema = z.object({
  instanceId: z
    .string()
    .regex(/^orbit_[a-z0-9-]+$/, "Invalid Orbit instance id."),
  pid: z.number().int().positive(),
  processStartedAt: z.string().datetime(),
  heartbeatAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const DurableAgentStateSchema = z.object({
  id: AgentIdSchema,
  role: z.string().min(1).max(80),
  task: z.string().min(1).max(8_000),
  status: z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "aborted",
    "blocked",
  ]),
  model: z.string().min(1).max(200),
  sessionId: SessionIdSchema.optional(),
  budgetUsd: z.number().finite().nonnegative(),
  costUsd: z.number().finite().nonnegative().default(0),
  access: z.object({
    mode: z.enum(["read", "write"]),
    scopes: z.array(z.string().min(1).max(1_000)).min(1).max(100),
  }),
  steering: z
    .object({
      count: z.number().int().nonnegative().max(10_000),
      lastAt: z.string().datetime().optional(),
    })
    .default({ count: 0 }),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  error: z.string().max(4_000).optional(),
});

export type DurableAgentState = z.infer<typeof DurableAgentStateSchema>;

export const AgentRunSchema = z.object({
  schemaVersion: z.literal(1),
  id: AgentRunIdSchema,
  task: z.string().min(1).max(20_000),
  status: z.enum(["running", "completed", "failed", "aborted"]),
  budgetUsd: z.number().finite().nonnegative(),
  costUsd: z.number().finite().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  owner: AgentRunOwnerSchema.optional(),
  /** Legacy field retained while schema-version 1 records are migrated lazily. */
  ownerPid: z.number().int().positive().optional(),
  agents: z.array(DurableAgentStateSchema).max(128),
});

export type AgentRun = z.infer<typeof AgentRunSchema>;

export interface CreateAgentRunInput {
  task: string;
  budgetUsd: number;
}

export interface AddAgentInput {
  role: string;
  task: string;
  model: string;
  budgetUsd: number;
  access: DurableAgentState["access"];
}

export interface AgentRunStoreOptions {
  now?: () => Date;
  ownerPid?: number;
  ownerInstanceId?: string;
  processStartedAt?: string;
  leaseDurationMs?: number;
  isProcessAlive?: (pid: number) => boolean;
}

/**
 * Persists bounded multi-agent execution state inside the workspace.
 *
 * Construction is side-effect free; call `initialize()` before writes.
 */
export class AgentRunStore {
  private readonly directory: string;
  private readonly now: () => Date;
  private readonly ownerPid: number;
  private readonly ownerInstanceId: string;
  private readonly processStartedAt: string;
  private readonly leaseDurationMs: number;
  private readonly processAlive: (pid: number) => boolean;
  private initialized = false;

  public constructor(
    private readonly cwd: string,
    options: AgentRunStoreOptions = {},
  ) {
    this.directory = resolve(cwd, ".orbit", "agent-runs");
    this.now = options.now ?? (() => new Date());
    this.ownerPid = options.ownerPid ?? process.pid;
    this.ownerInstanceId = options.ownerInstanceId ?? generateId("orbit");
    this.processStartedAt =
      options.processStartedAt ??
      new Date(Date.now() - process.uptime() * 1_000).toISOString();
    this.leaseDurationMs = Math.max(
      5_000,
      Math.min(options.leaseDurationMs ?? DEFAULT_AGENT_RUN_LEASE_MS, 300_000),
    );
    this.processAlive = options.isProcessAlive ?? isProcessAlive;
  }

  public initialize(): void {
    this.assertRunDirectoryWithinWorkspace();
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.assertRunDirectorySafe();
    this.initialized = true;
  }

  public createRun(input: CreateAgentRunInput): AgentRun {
    this.assertInitialized();
    const now = this.now().toISOString();
    const run = AgentRunSchema.parse({
      schemaVersion: 1,
      id: generateId("run"),
      task: input.task,
      status: "running",
      budgetUsd: input.budgetUsd,
      costUsd: 0,
      createdAt: now,
      updatedAt: now,
      owner: this.createOwnerLease(now),
      ownerPid: this.ownerPid,
      agents: [],
    });
    this.write(run);
    return run;
  }

  public addAgent(runId: string, input: AddAgentInput): DurableAgentState {
    return this.withRunLock(runId, () => {
      const run = this.requireRun(runId);
      this.assertOwnedByThisInstance(run);
      const agent = DurableAgentStateSchema.parse({
        id: generateId("agent"),
        ...input,
        status: "pending",
        costUsd: 0,
      });
      this.write({
        ...run,
        updatedAt: this.now().toISOString(),
        owner: this.createOwnerLease(),
        agents: [...run.agents, agent],
      });
      return agent;
    });
  }

  public updateAgent(
    runId: string,
    agentId: string,
    patch: Partial<
      Pick<
        DurableAgentState,
        | "status"
        | "costUsd"
        | "startedAt"
        | "endedAt"
        | "error"
        | "steering"
        | "sessionId"
      >
    >,
  ): DurableAgentState {
    AgentIdSchema.parse(agentId);
    return this.withRunLock(runId, () => {
      const run = this.requireRun(runId);
      this.assertOwnedByThisInstance(run);
      let updated: DurableAgentState | undefined;
      const agents = run.agents.map((agent) => {
        if (agent.id !== agentId) return agent;
        updated = DurableAgentStateSchema.parse({ ...agent, ...patch });
        return updated;
      });
      if (!updated) throw new Error(`Agent not found: ${agentId}`);
      this.write({
        ...run,
        costUsd: agents.reduce((sum, agent) => sum + agent.costUsd, 0),
        updatedAt: this.now().toISOString(),
        owner: this.createOwnerLease(),
        agents,
      });
      return updated;
    });
  }

  /** Record steering metadata without duplicating prompt content in run state. */
  public recordAgentSteering(
    runId: string,
    agentId: string,
    at = this.now().toISOString(),
  ): DurableAgentState {
    AgentIdSchema.parse(agentId);
    return this.withRunLock(runId, () => {
      const run = this.requireRun(runId);
      this.assertOwnedByThisInstance(run);
      let updated: DurableAgentState | undefined;
      const agents = run.agents.map((agent) => {
        if (agent.id !== agentId) return agent;
        updated = DurableAgentStateSchema.parse({
          ...agent,
          steering: {
            count: agent.steering.count + 1,
            lastAt: at,
          },
        });
        return updated;
      });
      if (!updated) throw new Error(`Agent not found: ${agentId}`);
      this.write({
        ...run,
        updatedAt: this.now().toISOString(),
        owner: this.createOwnerLease(),
        agents,
      });
      return updated;
    });
  }

  public finishRun(
    runId: string,
    status: "completed" | "failed" | "aborted",
  ): AgentRun {
    return this.withRunLock(runId, () => {
      const run = this.requireRun(runId);
      this.assertOwnedByThisInstance(run);
      const updated = AgentRunSchema.parse({
        ...run,
        status,
        costUsd: run.agents.reduce((sum, agent) => sum + agent.costUsd, 0),
        updatedAt: this.now().toISOString(),
        owner: this.createOwnerLease(),
      });
      this.write(updated);
      return updated;
    });
  }

  /**
   * Convert records owned by dead processes into explicit recoverable states.
   * A live Orbit process is never interrupted merely because another UI polls.
   */
  public recoverInterruptedRuns(): number {
    this.assertInitialized();
    let recovered = 0;
    const now = this.now().toISOString();
    for (const snapshot of this.readRuns()) {
      if (snapshot.status !== "running") continue;
      const didRecover = this.withRunLock(snapshot.id, () => {
        const run = this.requireRun(snapshot.id);
        if (run.status !== "running" || this.hasActiveOwner(run)) return false;
        const agents = run.agents.map((agent) => {
          if (agent.status === "running") {
            return DurableAgentStateSchema.parse({
              ...agent,
              status: "failed",
              endedAt: now,
              error:
                "The owning Orbit process stopped renewing its lease before this agent finished. " +
                "Its persisted child session can be resumed explicitly.",
            });
          }
          if (agent.status === "pending") {
            return DurableAgentStateSchema.parse({
              ...agent,
              status: "blocked",
              endedAt: now,
              error:
                "The owning Orbit process exited before this agent started.",
            });
          }
          return agent;
        });
        this.write({
          ...run,
          status: "failed",
          updatedAt: now,
          agents,
        });
        return true;
      });
      if (didRecover) recovered += 1;
    }
    return recovered;
  }

  /** Reopen one persisted child session under the current Orbit process. */
  public resumeAgent(runId: string, agentId: string): DurableAgentState {
    this.assertInitialized();
    AgentIdSchema.parse(agentId);
    return this.withRunLock(runId, () => {
      const run = this.requireRun(runId);
      const target = run.agents.find((agent) => agent.id === agentId);
      if (!target) throw new Error(`Agent not found: ${agentId}`);
      if (!target.sessionId) {
        throw new Error(`Agent ${agentId} has no persisted child session.`);
      }
      if (run.status === "running" && this.hasActiveOwner(run)) {
        throw new Error(`Agent run ${runId} is still owned by a live process.`);
      }
      if (target.status === "completed") {
        throw new Error(`Agent ${agentId} already completed successfully.`);
      }
      const now = this.now().toISOString();
      const resumed = DurableAgentStateSchema.parse({
        ...target,
        status: "running",
        startedAt: now,
        endedAt: undefined,
        error: undefined,
      });
      this.write({
        ...run,
        status: "running",
        owner: this.createOwnerLease(now),
        ownerPid: this.ownerPid,
        updatedAt: now,
        agents: run.agents.map((agent) =>
          agent.id === agentId ? resumed : agent,
        ),
      });
      return resumed;
    });
  }

  /** Extend the current process lease without changing task or agent state. */
  public renewLease(runId: string): AgentRun {
    return this.withRunLock(runId, () => {
      const run = this.requireRun(runId);
      this.assertOwnedByThisInstance(run);
      const updated = AgentRunSchema.parse({
        ...run,
        owner: this.createOwnerLease(),
        ownerPid: this.ownerPid,
        updatedAt: this.now().toISOString(),
      });
      this.write(updated);
      return updated;
    });
  }

  /**
   * Keep a run lease current while long provider or tool work is in flight.
   * The returned cleanup callback is idempotent and the timer never keeps the
   * process alive on its own.
   */
  public startLeaseHeartbeat(runId: string): () => void {
    this.renewLease(runId);
    let active = true;
    const heartbeat = setInterval(
      () => {
        if (!active) return;
        try {
          this.renewLease(runId);
        } catch {
          active = false;
          clearInterval(heartbeat);
        }
      },
      Math.max(1_000, Math.floor(this.leaseDurationMs / 3)),
    );
    heartbeat.unref();
    return () => {
      if (!active) return;
      active = false;
      clearInterval(heartbeat);
    };
  }

  public getRun(runId: string): AgentRun | undefined {
    AgentRunIdSchema.parse(runId);
    if (existsSync(this.directory)) this.assertRunDirectorySafe();
    const file = this.resolveRunFile(runId);
    if (!existsSync(file)) return undefined;
    return this.read(file);
  }

  public listRuns(limit = 20): AgentRun[] {
    return this.readRuns().slice(0, Math.max(1, Math.min(100, limit)));
  }

  private readRuns(): AgentRun[] {
    if (!existsSync(this.directory)) return [];
    this.assertRunDirectorySafe();
    return readdirSync(this.directory)
      .filter((name) => /^run_[a-z0-9-]+\.json$/.test(name))
      .flatMap((name) => {
        try {
          return [
            this.read(
              resolveSafePath(this.cwd, join(".orbit", "agent-runs", name)),
            ),
          ];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private requireRun(runId: string): AgentRun {
    this.assertInitialized();
    const run = this.getRun(runId);
    if (!run) throw new Error(`Agent run not found: ${runId}`);
    return run;
  }

  private read(file: string): AgentRun {
    try {
      const raw = readBoundedRegularFile(file, AGENT_RUN_MAX_BYTES);
      if (raw === undefined) {
        throw new Error("Agent run file is missing.");
      }
      return AgentRunSchema.parse(JSON.parse(raw));
    } catch (error: unknown) {
      throw new Error(
        `Invalid agent run ${basename(file)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private write(run: AgentRun): void {
    this.assertInitialized();
    const validated = AgentRunSchema.parse(run);
    const file = this.resolveRunFile(validated.id);
    replacePrivateFileAtomically(
      file,
      `${JSON.stringify(validated, null, 2)}\n`,
    );
  }

  private resolveRunFile(runId: string): string {
    AgentRunIdSchema.parse(runId);
    return resolveSafePath(
      this.cwd,
      join(".orbit", "agent-runs", `${runId}.json`),
    );
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("AgentRunStore.initialize() must be called first.");
    }
  }

  private assertRunDirectorySafe(): void {
    this.assertRunDirectoryWithinWorkspace();
    const stats = lstatSync(this.directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("Orbit agent-run directory must be a real directory.");
    }
  }

  private assertRunDirectoryWithinWorkspace(): void {
    const safeDirectory = resolveSafePath(
      this.cwd,
      join(".orbit", "agent-runs"),
    );
    if (resolve(safeDirectory) !== this.directory) {
      throw new Error("Orbit agent-run directory escaped the workspace.");
    }
  }

  /** Serialize read-check-write mutations across Orbit processes. */
  private withRunLock<T>(runId: string, operation: () => T): T {
    this.assertInitialized();
    const lockPath = `${this.resolveRunFile(runId)}.lock`;
    for (let attempt = 0; attempt < AGENT_RUN_LOCK_RETRIES; attempt += 1) {
      let handle: number;
      try {
        handle = openSync(lockPath, "wx", 0o600);
      } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        if (removeStaleRunLock(lockPath)) continue;
        if (attempt === AGENT_RUN_LOCK_RETRIES - 1) {
          throw new Error(`Agent run ${runId} is busy. Try again.`);
        }
        Atomics.wait(AGENT_RUN_LOCK_WAIT, 0, 0, AGENT_RUN_LOCK_WAIT_MS);
        continue;
      }
      try {
        return operation();
      } finally {
        closeSync(handle);
        try {
          unlinkSync(lockPath);
        } catch {
          // A stale lock is recoverable on the next mutation.
        }
      }
    }
    throw new Error(`Agent run ${runId} could not be locked.`);
  }

  private createOwnerLease(heartbeatAt = this.now().toISOString()) {
    return AgentRunOwnerSchema.parse({
      instanceId: this.ownerInstanceId,
      pid: this.ownerPid,
      processStartedAt: this.processStartedAt,
      heartbeatAt,
      expiresAt: new Date(
        new Date(heartbeatAt).getTime() + this.leaseDurationMs,
      ).toISOString(),
    });
  }

  private hasActiveOwner(run: AgentRun): boolean {
    if (run.owner) {
      return (
        this.processAlive(run.owner.pid) &&
        Date.parse(run.owner.expiresAt) > this.now().getTime()
      );
    }
    return run.ownerPid !== undefined && this.processAlive(run.ownerPid);
  }

  private assertOwnedByThisInstance(run: AgentRun): void {
    if (run.owner) {
      if (run.owner.instanceId !== this.ownerInstanceId) {
        throw new Error(
          `Agent run ${run.id} is owned by another Orbit instance.`,
        );
      }
      return;
    }
    if (run.ownerPid !== undefined && run.ownerPid !== this.ownerPid) {
      throw new Error(`Agent run ${run.id} is owned by another process.`);
    }
  }
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeStaleRunLock(lockPath: string): boolean {
  try {
    const lock = lstatSync(lockPath);
    if (
      !lock.isFile() ||
      Date.now() - lock.mtimeMs <= AGENT_RUN_STALE_LOCK_MS
    ) {
      return false;
    }
    unlinkSync(lockPath);
    return true;
  } catch (error: unknown) {
    return isNodeError(error) && error.code === "ENOENT";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
