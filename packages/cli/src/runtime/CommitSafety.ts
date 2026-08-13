import { redactSecrets } from "@orbit-build/shared";

const SENSITIVE_DIFF_PATH =
  /(?:^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.pypirc$|\.netrc$|\.ssh\/|\.gnupg\/|\.aws\/|\.azure\/|\.kube\/|\.git\/|\.orbit\/)|\.(?:key|pem|p12|pfx)$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_COMMIT_SUBJECT_LENGTH = 120;

/** Build a bounded, redacted diff safe to include in a remote model request. */
export function buildCommitDiffForModel(
  diff: string,
  maxChars = 20_000,
): string {
  const blocks = diff.split(/(?=^diff --git )/m);
  const visible = blocks.map((block) => {
    const path = block.match(/^diff --git a\/(.+?) b\/(.+)$/m)?.[2];
    if (path && SENSITIVE_DIFF_PATH.test(path)) {
      return `diff --git a/${path} b/${path}\n[Orbit omitted protected file contents]`;
    }
    return redactSecrets(block);
  });
  return visible.join("").slice(0, Math.max(0, maxChars));
}

/** Normalize generated or user-supplied text into one safe Git subject line. */
export function normalizeCommitMessage(message: string): string {
  const subject = redactSecrets(message)
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/^\s*["'`]+|["'`]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COMMIT_SUBJECT_LENGTH)
    .trim();
  if (!subject) return "chore: update project";
  return /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9._/-]+\))?!?:\s+\S/i.test(
    subject,
  )
    ? subject
    : `chore: ${subject}`.slice(0, MAX_COMMIT_SUBJECT_LENGTH).trim();
}
