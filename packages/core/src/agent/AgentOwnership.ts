import { z } from "zod";

const RawAgentOwnershipScopeSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Agent ownership scopes cannot contain control characters.",
  });

/** A normalized workspace-relative ownership scope; `*` owns the workspace. */
export const AgentOwnershipScopeSchema = RawAgentOwnershipScopeSchema.transform(
  (value, context) => {
    const normalized = normalizeUnchecked(value);
    if (!normalized) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Agent ownership scopes must be workspace-relative and cannot traverse directories.",
      });
      return z.NEVER;
    }
    return normalized;
  },
);

export const AgentTaskAccessSchema = z.object({
  mode: z.enum(["read", "write"]),
  scopes: z.array(AgentOwnershipScopeSchema).min(1).max(100),
});

export type NormalizedAgentTaskAccess = z.infer<typeof AgentTaskAccessSchema>;

/** Validate and normalize an ownership scope at the scheduling boundary. */
export function normalizeAgentOwnershipScope(scope: string): string {
  return AgentOwnershipScopeSchema.parse(scope);
}

/** Whether two validated logical ownership scopes cover common files. */
export function agentOwnershipScopesOverlap(
  left: string,
  right: string,
): boolean {
  const normalizedLeft = normalizeAgentOwnershipScope(left);
  const normalizedRight = normalizeAgentOwnershipScope(right);
  if (normalizedLeft === "*" || normalizedRight === "*") return true;
  const comparableLeft = comparableScope(normalizedLeft);
  const comparableRight = comparableScope(normalizedRight);
  return (
    comparableLeft === comparableRight ||
    comparableLeft.startsWith(`${comparableRight}/`) ||
    comparableRight.startsWith(`${comparableLeft}/`)
  );
}

/** Whether a workspace-relative file is owned by one validated scope. */
export function agentOwnershipScopeContains(
  scope: string,
  filePath: string,
): boolean {
  const normalizedScope = normalizeAgentOwnershipScope(scope);
  const normalizedFile = normalizeUnchecked(filePath);
  if (!normalizedFile || normalizedFile === "*") return false;
  if (normalizedScope === "*") return true;
  const comparableOwner = comparableScope(normalizedScope);
  const comparableFile = comparableScope(normalizedFile);
  return (
    comparableFile === comparableOwner ||
    comparableFile.startsWith(`${comparableOwner}/`)
  );
}

function normalizeUnchecked(scope: string): string | undefined {
  const portable = scope.trim().replace(/\\/g, "/");
  if (portable === "*" || portable.toLowerCase() === "workspace") return "*";
  if (
    portable.startsWith("/") ||
    portable.startsWith("//") ||
    /^[A-Za-z]:/.test(portable)
  ) {
    return undefined;
  }
  const parts = portable.split("/").filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    return undefined;
  }
  return parts.join("/");
}

function comparableScope(scope: string): string {
  return process.platform === "win32" ? scope.toLowerCase() : scope;
}
