import { createHash, randomUUID } from "crypto";
import type { OrbitConfig } from "@orbit-build/config";
import { eventBus, type AgentLoopRunOutcome } from "@orbit-build/core";
import {
  readBoundedRegularFileBuffer,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";
import {
  expandCustomCommand,
  type CustomCommand,
} from "../../commands/customCommands.js";
import { checkWorkflowDependencies } from "../WorkflowPreflight.js";
import {
  WorkflowStagesSchema,
  type WorkflowRun,
  type WorkflowStage,
} from "./WorkflowSchema.js";
import { WorkflowStore } from "./WorkflowStore.js";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function workflowDefinitionHash(command: CustomCommand): string {
  return hash(
    JSON.stringify({
      name: command.name,
      template: command.template,
      skills: command.skills ?? [],
      stages: command.stages,
    }),
  );
}
function artifactHash(cwd: string, path: string): string {
  const content = readBoundedRegularFileBuffer(
    resolveSafePath(cwd, path),
    16 * 1024 * 1024,
  );
  if (!content?.length)
    throw new Error(`Required artifact is missing or empty: ${path}`);
  return hash(content);
}
export interface WorkflowExecution {
  cwd: string;
  command: CustomCommand;
  config: OrbitConfig["skills"];
  sessionId: string;
  input?: string;
  resumeId?: string;
  signal: AbortSignal;
  execute(prompt: string, stage: WorkflowStage): Promise<AgentLoopRunOutcome>;
}
/** Execute sequential stages; advance only on real outcomes and passing gates. */
export async function runStructuredWorkflow(
  options: WorkflowExecution,
): Promise<WorkflowRun> {
  const stages = WorkflowStagesSchema.parse(options.command.stages);
  const store = new WorkflowStore(options.cwd);
  const release = store.acquire(Boolean(options.resumeId));
  try {
    const now = new Date().toISOString();
    const run: WorkflowRun = options.resumeId
      ? store.read(options.resumeId)
      : {
          schemaVersion: 1,
          id: `wf_${randomUUID()}`,
          command: options.command.name,
          definitionHash: workflowDefinitionHash(options.command),
          sessionId: options.sessionId,
          input: redactSecrets(options.input ?? ""),
          status: "running",
          createdAt: now,
          updatedAt: now,
          stages: stages.map((stage) => ({
            id: stage.id,
            status: "pending",
            attempts: 0,
            verification: "not_run",
            artifacts: [],
          })),
        };
    if (run.sessionId !== options.sessionId)
      throw new Error(`Resume the original session ${run.sessionId} first.`);
    if (run.definitionHash !== workflowDefinitionHash(options.command))
      throw new Error(
        "Workflow definition changed. Inspect it and start a new run.",
      );
    if (
      run.stages.length !== stages.length ||
      run.stages.some((stage, index) => stage.id !== stages[index].id)
    )
      throw new Error("Workflow stage state does not match its definition.");
    if (run.status === "cancelled")
      throw new Error(
        "This workflow was cancelled. Start a new run if needed.",
      );
    let unfinished = false;
    for (const [index, stage] of run.stages.entries()) {
      if (stage.status !== "completed") unfinished = true;
      else {
        if (unfinished)
          throw new Error(
            "Invalid workflow state: completed stages must form a prefix.",
          );
        if (
          (stages[index].verification && stage.verification !== "passed") ||
          JSON.stringify(stage.artifacts.map((artifact) => artifact.path)) !==
            JSON.stringify(stages[index].artifacts)
        )
          throw new Error("Completed stage lacks its declared gate evidence.");
        for (const artifact of stage.artifacts)
          if (artifactHash(options.cwd, artifact.path) !== artifact.sha256)
            throw new Error(
              `Completed artifact changed: ${artifact.path}. Start a new run after review.`,
            );
      }
    }
    const save = () => {
      run.updatedAt = new Date().toISOString();
      store.save(run);
    };
    run.status = "running";
    save();
    eventBus.emitEvent("info", {
      message: `Workflow ${run.command}: ${run.id}`,
    });
    for (const [index, stage] of stages.entries()) {
      const state = run.stages[index];
      if (state.status === "completed") continue;
      if (options.signal.aborted) {
        run.status = "interrupted";
        save();
        return run;
      }
      state.status = "running";
      state.attempts++;
      state.error = undefined;
      save();
      eventBus.emitEvent("info", {
        message: `● Workflow ${run.id}: ${index + 1}/${stages.length} ${stage.title}`,
      });
      try {
        const skills = [
          ...new Set([...(options.command.skills ?? []), ...stage.skills]),
        ];
        const problem = await checkWorkflowDependencies(
          options.cwd,
          { ...options.command, skills },
          options.config,
        );
        if (options.signal.aborted) {
          state.status = "interrupted";
          run.status = "interrupted";
          save();
          return run;
        }
        if (problem) throw new Error(problem);
        for (const completed of run.stages.filter(
          (item) => item.status === "completed",
        )) {
          for (const artifact of completed.artifacts)
            if (artifactHash(options.cwd, artifact.path) !== artifact.sha256)
              throw new Error(`Completed artifact changed: ${artifact.path}`);
        }
        const prompt = expandCustomCommand(
          {
            ...options.command,
            skills,
            template: `${options.command.template}\n\nStage ${index + 1}/${stages.length}: ${stage.title}\n${stage.prompt}\n\nExecute only this stage; do not perform future stages.\nRequired artifacts: ${stage.artifacts.join(", ") || "none"}.\n${stage.verification ? "Run the project verification contract and obtain passing verification evidence before finishing." : "Report the outcome and evidence honestly."}`,
          },
          run.input,
        );
        const outcome = await options.execute(prompt, stage);
        if (options.signal.aborted || outcome.status === "aborted") {
          state.status = "interrupted";
          run.status = "interrupted";
          save();
          return run;
        }
        if (outcome.status === "failed") throw new Error(outcome.error.message);
        state.verification = outcome.receipt?.verification ?? "not_run";
        if (stage.verification && state.verification !== "passed")
          throw new Error(
            "Stage requires passing verification evidence, but the AgentLoop receipt does not contain it.",
          );
        state.artifacts = stage.artifacts.map((path) => ({
          path,
          sha256: artifactHash(options.cwd, path),
        }));
        for (const completed of run.stages.filter(
          (item) => item.status === "completed",
        )) {
          for (const artifact of completed.artifacts)
            if (artifactHash(options.cwd, artifact.path) !== artifact.sha256)
              throw new Error(
                `Stage changed a completed artifact: ${artifact.path}`,
              );
        }
        state.status = "completed";
        save();
      } catch (error: unknown) {
        state.status = options.signal.aborted ? "interrupted" : "failed";
        run.status = state.status;
        state.error = redactSecrets(
          error instanceof Error ? error.message : String(error),
        ).slice(0, 2000);
        save();
        eventBus.emitEvent("warning", {
          message: `Workflow ${run.id} stopped at ${stage.id}: ${state.error}`,
        });
        return run;
      }
    }
    run.status = "completed";
    save();
    eventBus.emitEvent("info", {
      message: `✔ Workflow ${run.id} completed with all stage gates passed.`,
    });
    return run;
  } finally {
    release();
  }
}
