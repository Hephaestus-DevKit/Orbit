import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, join, resolve } from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { generateId, resolveSafePath } from "@orbit-build/shared";

const AgentIdSchema = z
  .string()
  .regex(/^agent_[a-z0-9-]+$/, "Invalid agent id.");
const AgentRunIdSchema = z
  .string()
  .regex(/^run_[a-z0-9-]+$/, "Invalid agent run id.");

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
  budgetUsd: z.number().finite().nonnegative(),
  costUsd: z.number().finite().nonnegative().default(0),
  access: z.object({
    mode: z.enum(["read", "write"]),
    scopes: z.array(z.string().min(1).max(1_000)).min(1).max(100),
  }),
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

/**
 * Persists bounded multi-agent execution state inside the workspace.
 *
 * Construction is side-effect free; call `initialize()` before writes.
 */
export class AgentRunStore {
  private readonly directory: string;
  private initialized = false;

  public constructor(private readonly cwd: string) {
    this.directory = resolve(cwd, ".orbit", "agent-runs");
  }

  public initialize(): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.initialized = true;
  }

  public createRun(input: CreateAgentRunInput): AgentRun {
    this.assertInitialized();
    const now = new Date().toISOString();
    const run = AgentRunSchema.parse({
      schemaVersion: 1,
      id: generateId("run"),
      task: input.task,
      status: "running",
      budgetUsd: input.budgetUsd,
      costUsd: 0,
      createdAt: now,
      updatedAt: now,
      agents: [],
    });
    this.write(run);
    return run;
  }

  public addAgent(runId: string, input: AddAgentInput): DurableAgentState {
    const run = this.requireRun(runId);
    const agent = DurableAgentStateSchema.parse({
      id: generateId("agent"),
      ...input,
      status: "pending",
      costUsd: 0,
    });
    this.write({
      ...run,
      updatedAt: new Date().toISOString(),
      agents: [...run.agents, agent],
    });
    return agent;
  }

  public updateAgent(
    runId: string,
    agentId: string,
    patch: Partial<
      Pick<
        DurableAgentState,
        "status" | "costUsd" | "startedAt" | "endedAt" | "error"
      >
    >,
  ): DurableAgentState {
    AgentIdSchema.parse(agentId);
    const run = this.requireRun(runId);
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
      updatedAt: new Date().toISOString(),
      agents,
    });
    return updated;
  }

  public finishRun(
    runId: string,
    status: "completed" | "failed" | "aborted",
  ): AgentRun {
    const run = this.requireRun(runId);
    const updated = AgentRunSchema.parse({
      ...run,
      status,
      costUsd: run.agents.reduce((sum, agent) => sum + agent.costUsd, 0),
      updatedAt: new Date().toISOString(),
    });
    this.write(updated);
    return updated;
  }

  public getRun(runId: string): AgentRun | undefined {
    AgentRunIdSchema.parse(runId);
    const file = this.resolveRunFile(runId);
    if (!existsSync(file)) return undefined;
    return this.read(file);
  }

  public listRuns(limit = 20): AgentRun[] {
    if (!existsSync(this.directory)) return [];
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
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(1, Math.min(100, limit)));
  }

  private requireRun(runId: string): AgentRun {
    this.assertInitialized();
    const run = this.getRun(runId);
    if (!run) throw new Error(`Agent run not found: ${runId}`);
    return run;
  }

  private read(file: string): AgentRun {
    try {
      return AgentRunSchema.parse(JSON.parse(readFileSync(file, "utf8")));
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
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const previous = `${file}.${process.pid}.${randomUUID()}.bak`;
    writeFileSync(temporary, JSON.stringify(validated, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    let movedPrevious = false;
    try {
      if (existsSync(file)) {
        renameSync(file, previous);
        movedPrevious = true;
      }
      renameSync(temporary, file);
      if (movedPrevious) rmSync(previous, { force: true });
    } catch (error: unknown) {
      if (movedPrevious && !existsSync(file) && existsSync(previous)) {
        renameSync(previous, file);
      }
      throw error;
    } finally {
      rmSync(temporary, { force: true });
      if (existsSync(file)) rmSync(previous, { force: true });
    }
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
}
