import type { SessionTraceBundle } from "@orbit-build/session";
import { redactSecrets } from "@orbit-build/shared";

export interface CompiledWorkflowSkill {
  description: string;
  instructions: string;
  observedTools: string[];
  verificationRuns: number;
}

/** Compile a redacted trace into guidance, never an executable side-effect replay. */
export function compileWorkflowSkill(
  trace: SessionTraceBundle,
  descriptionOverride?: string,
): CompiledWorkflowSkill {
  const observedTools = [
    ...new Set(trace.toolCalls.map((call) => call.toolName)),
  ]
    .sort()
    .slice(0, 100);
  const successfulTools = trace.toolCalls.filter(
    (call) => call.status === "success",
  );
  const failedTools = trace.toolCalls.filter(
    (call) => call.status === "failed" || call.status === "denied",
  );
  const verificationEvents = trace.events.filter(
    (event) => event.type === "verification_ended",
  );
  const planSteps = (trace.plan?.items ?? [])
    .map((item) => redactSecrets(item.text).trim())
    .filter(Boolean)
    .slice(0, 50);
  const workflowSteps =
    planSteps.length > 0 ? planSteps : deriveWorkflowSteps(observedTools);
  const title = redactSecrets(trace.session.title || "Recorded Orbit workflow")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const description = redactSecrets(descriptionOverride || title)
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 240);

  const instructions = [
    "# Objective",
    "",
    redactSecrets(trace.session.goal || title).slice(0, 2_000),
    "",
    "# Reusable workflow",
    "",
    ...workflowSteps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "# Execution contract",
    "",
    "- Re-inspect the current workspace before acting; recorded paths, commands, outputs, and assumptions are historical evidence only.",
    "- Never replay a recorded shell command or tool argument verbatim. Reconstruct the smallest current operation and route it through Orbit permissions.",
    "- Keep writes inside the authorized workspace and preserve unrelated dirty or staged changes.",
    "- Run the repository's current verification contract after edits. Repair the earliest root failure, then rerun the wider gate.",
    "- Stop and report a blocker when required authority, credentials, or external state is missing.",
    "",
    "# Observed strategy",
    "",
    `- Successful tool actions in the source run: ${successfulTools.length}.`,
    `- Failed or denied actions in the source run: ${failedTools.length}. Treat these as signals to inspect assumptions before retrying.`,
    `- Verification runs observed: ${verificationEvents.length}.`,
    `- Tool families observed: ${observedTools.join(", ") || "none"}.`,
    "",
    "This Skill was derived from a credential-redacted Orbit trace. It intentionally excludes raw prompts, tool arguments, command output, diffs, and local absolute paths.",
  ]
    .join("\n")
    .slice(0, 24_000);

  return {
    description:
      description ||
      "A reviewable workflow compiled from Orbit trace evidence.",
    instructions,
    observedTools,
    verificationRuns: verificationEvents.length,
  };
}

function deriveWorkflowSteps(observedTools: string[]): string[] {
  const steps = [
    "Clarify the requested outcome, constraints, authorized workspace, and acceptance evidence.",
  ];
  if (observedTools.some((tool) => /read|search|list|symbol/i.test(tool))) {
    steps.push(
      "Inspect repository landmarks and the smallest relevant files before proposing changes.",
    );
  }
  if (observedTools.some((tool) => /write|edit|replace|patch/i.test(tool))) {
    steps.push(
      "Apply scoped, reviewable edits while preserving unrelated user changes.",
    );
  }
  if (observedTools.some((tool) => /test|bash|shell|command/i.test(tool))) {
    steps.push(
      "Execute the smallest relevant verification first, then expand according to risk.",
    );
  }
  steps.push(
    "Inspect the final diff, summarize verified outcomes, and disclose any remaining uncertainty.",
  );
  return steps;
}
