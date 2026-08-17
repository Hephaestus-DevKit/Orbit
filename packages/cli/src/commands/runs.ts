import picocolors from "picocolors";
import { AgentRunStore, type AgentRun } from "@orbit-build/session";
import { redactSecrets } from "@orbit-build/shared";

export interface RunsCommandOptions {
  cwd?: string;
  json?: boolean;
  limit?: number;
}

type RunAction = "list" | "inspect" | "recover";

/**
 * Inspect the durable Agent control plane without attaching to a running UI.
 *
 * This is intentionally read-mostly: `recover` only converts expired leases
 * into explicit failed/blocked records. It never deletes a run or pretends
 * that a child session has been resumed.
 */
export function runRunsCommand(
  action: RunAction,
  runId?: string,
  options: RunsCommandOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const store = new AgentRunStore(cwd);
  try {
    if (action === "recover") {
      store.initialize();
      const recovered = store.recoverInterruptedRuns();
      emitRecovery(recovered, options.json === true);
      return 0;
    }

    if (action === "inspect") {
      if (!runId) return emitError("runs inspect requires a run id.", options);
      const run = store.getRun(runId);
      if (!run) return emitError(`Agent run not found: ${runId}.`, options);
      emitInspection(run, options.json === true);
      return 0;
    }

    const limit = normalizeLimit(options.limit);
    const runs = store.listRuns(limit);
    emitRunList(runs, options.json === true, limit);
    return 0;
  } catch (error: unknown) {
    return emitError(errorMessage(error), options);
  }
}

function emitRunList(runs: AgentRun[], json: boolean, limit: number): void {
  const summaries = runs.map(toRunSummary);
  if (json) {
    console.log(
      JSON.stringify({ schemaVersion: 1, limit, runs: summaries }, null, 2),
    );
    return;
  }
  if (runs.length === 0) {
    console.log("No durable Agent runs found.");
    return;
  }
  console.log(picocolors.bold(`\nAgent runs (${runs.length})\n`));
  for (const summary of summaries) {
    console.log(
      `${statusColor(summary.status)(summary.status)} ${picocolors.cyan(summary.id)} ` +
        `${summary.agentCount} agent(s) · ${formatCost(summary.costUsd)} / ${formatCost(summary.budgetUsd)}`,
    );
    console.log(`  ${summary.task}`);
    console.log(picocolors.gray(`  updated ${summary.updatedAt}`));
  }
}

function emitInspection(run: AgentRun, json: boolean): void {
  const view = {
    schemaVersion: 1,
    id: run.id,
    status: run.status,
    task: redactSecrets(run.task),
    budgetUsd: run.budgetUsd,
    costUsd: run.costUsd,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    owner: run.owner
      ? {
          heartbeatAt: run.owner.heartbeatAt,
          expiresAt: run.owner.expiresAt,
          active: Date.parse(run.owner.expiresAt) > Date.now(),
        }
      : undefined,
    agents: run.agents.map((agent) => ({
      id: agent.id,
      role: agent.role,
      task: redactSecrets(agent.task),
      status: agent.status,
      model: agent.model,
      budgetUsd: agent.budgetUsd,
      costUsd: agent.costUsd,
      sessionId: agent.sessionId,
      access: agent.access,
      steering: agent.steering,
      startedAt: agent.startedAt,
      endedAt: agent.endedAt,
      error: agent.error ? redactSecrets(agent.error) : undefined,
    })),
  };
  if (json) {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  console.log(picocolors.bold(`\n${view.id}\n`));
  console.log(`  Status: ${statusColor(view.status)(view.status)}`);
  console.log(`  Task: ${view.task}`);
  console.log(
    `  Cost: ${formatCost(view.costUsd)} / ${formatCost(view.budgetUsd)}`,
  );
  console.log(`  Updated: ${view.updatedAt}`);
  if (view.owner) {
    console.log(
      picocolors.gray(
        `  Lease: ${view.owner.active ? "active" : "expired"} · expires ${view.owner.expiresAt}`,
      ),
    );
  }
  if (view.agents.length === 0) {
    console.log("  Agents: none");
    return;
  }
  console.log(`  Agents: ${view.agents.length}`);
  for (const agent of view.agents) {
    console.log(
      `    ${statusColor(agent.status)(agent.status)} ${agent.id} · ${agent.role} · ${agent.model}`,
    );
    console.log(picocolors.gray(`      ${agent.task}`));
    if (agent.error) console.log(picocolors.red(`      ${agent.error}`));
  }
}

function emitRecovery(recovered: number, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, recovered }));
    return;
  }
  if (recovered === 0) {
    console.log(picocolors.green("✔ No expired Agent run leases found."));
  } else {
    console.log(
      picocolors.yellow(
        `⚠ Recovered ${recovered} interrupted Agent run(s). Child sessions remain available for explicit inspection/resume.`,
      ),
    );
  }
}

function emitError(message: string, options: RunsCommandOptions): number {
  const safe = redactSecrets(message);
  if (options.json) {
    console.log(JSON.stringify({ schemaVersion: 1, error: safe }));
  } else {
    console.error(picocolors.red(`✖ ${safe}`));
  }
  return 1;
}

function toRunSummary(run: AgentRun) {
  const agentsByStatus = Object.fromEntries(
    run.agents.reduce((counts, agent) => {
      counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  );
  return {
    id: run.id,
    status: run.status,
    task: redactSecrets(run.task),
    budgetUsd: run.budgetUsd,
    costUsd: run.costUsd,
    agentCount: run.agents.length,
    agentsByStatus,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("--limit must be an integer from 1 to 100.");
  }
  return value;
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function statusColor(status: string): (value: string) => string {
  if (status === "completed") return picocolors.green;
  if (status === "failed" || status === "aborted") return picocolors.red;
  if (status === "running") return picocolors.cyan;
  return picocolors.yellow;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
