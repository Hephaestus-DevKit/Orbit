import type { Readable } from "node:stream";
import { MAX_AGENT_MAX_ITERATIONS } from "@orbit-build/config";
import { z } from "zod";

const maxInputBytes = 1024 * 1024;
const promptSchema = z.string().refine(text => text.trim().length > 0 && !text.includes("\0"));
const turnsSchema = z.string().regex(/^\d+$/).transform(Number).pipe(
  z.number().int().min(1).max(MAX_AGENT_MAX_ITERATIONS),
);

/** Validate an optional per-invocation limit before starting the runtime. */
export function parseExecMaxTurns(value: string): number {
  const result = turnsSchema.safeParse(value);
  if (!result.success)
    throw new Error("Expected --max-turns from 1 to " + MAX_AGENT_MAX_ITERATIONS + ".");
  return result.data;
}

/** Resolve a positional task or read a bounded UTF-8 task from a pipe. */
export async function readExecPrompt(
  argument: string | undefined,
  input: Readable & { isTTY?: boolean } = process.stdin,
): Promise<string> {
  let prompt = argument;
  if (prompt === undefined || prompt === "-") {
    if (input.isTTY) throw new Error("Pass a task to orbit exec or pipe a UTF-8 prompt into it.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxInputBytes) throw new Error("The piped task exceeds 1 MiB.");
      chunks.push(bytes);
    }
    try {
      prompt = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
    } catch {
      throw new Error("The piped task must be UTF-8 text.");
    }
  }
  if (!promptSchema.safeParse(prompt).success)
    throw new Error("Provide a non-empty text task without NUL bytes.");
  return prompt;
}
