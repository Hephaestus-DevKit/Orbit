import { redactSecrets } from "@orbit-build/shared";

/** Project durable agent records into a bounded, credential-safe browser view. */
export function summarizeWebUiAgentRuns(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((candidate) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.agents)) return [];
    const id = boundedString(candidate.id, 128);
    if (!/^run_[a-z0-9-]+$/.test(id)) return [];
    return [
      {
        id,
        task: redactSecrets(boundedString(candidate.task, 2_000)),
        status: boundedEnum(candidate.status, [
          "running",
          "completed",
          "failed",
          "aborted",
        ]),
        budgetUsd: finiteNumber(candidate.budgetUsd),
        costUsd: finiteNumber(candidate.costUsd),
        updatedAt: boundedString(candidate.updatedAt, 64),
        agents: candidate.agents.slice(0, 64).flatMap((agent) => {
          if (!isRecord(agent)) return [];
          const agentId = boundedString(agent.id, 128);
          if (!/^agent_[a-z0-9-]+$/.test(agentId)) return [];
          return [
            {
              id: agentId,
              role: redactSecrets(boundedString(agent.role, 80)),
              task: redactSecrets(boundedString(agent.task, 1_000)),
              status: boundedEnum(agent.status, [
                "pending",
                "running",
                "completed",
                "failed",
                "aborted",
                "blocked",
              ]),
              model: redactSecrets(boundedString(agent.model, 200)),
              sessionId: /^sess_[a-z]+-[a-z]+-\d{3}$/.test(
                boundedString(agent.sessionId, 128),
              )
                ? boundedString(agent.sessionId, 128)
                : "",
              budgetUsd: finiteNumber(agent.budgetUsd),
              costUsd: finiteNumber(agent.costUsd),
              access:
                isRecord(agent.access) && agent.access.mode === "write"
                  ? "write"
                  : "read",
              scopes:
                isRecord(agent.access) && Array.isArray(agent.access.scopes)
                  ? agent.access.scopes
                      .slice(0, 20)
                      .map((scope) => redactSecrets(boundedString(scope, 300)))
                  : [],
              startedAt: boundedString(agent.startedAt, 64),
              endedAt: boundedString(agent.endedAt, 64),
              error: redactSecrets(boundedString(agent.error, 1_000)),
              steeringCount:
                isRecord(agent.steering) &&
                typeof agent.steering.count === "number" &&
                Number.isFinite(agent.steering.count)
                  ? Math.max(0, Math.floor(agent.steering.count))
                  : 0,
              lastSteeredAt:
                isRecord(agent.steering) &&
                typeof agent.steering.lastAt === "string"
                  ? boundedString(agent.steering.lastAt, 64)
                  : "",
            },
          ];
        }),
      },
    ];
  });
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function boundedEnum<T extends string>(
  value: unknown,
  values: readonly T[],
): T | "unknown" {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
