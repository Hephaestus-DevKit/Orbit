import { createHmac } from "node:crypto";
import { z } from "zod";
import { readResponseTextWithinLimit } from "@orbit-build/shared";
import type { ModelChatInput, OrbitContentBlock } from "../types.js";

const ids = new WeakMap<OrbitContentBlock, string>();
const FileResponse = z.object({
  id: z
    .string()
    .regex(/^file-api-[A-Za-z0-9_-]+$/)
    .max(512),
  expires_at: z.number().finite().positive().optional(),
});

/** Transient request-only reference; never serialized into durable Orbit history. */
export function deepSeekImageFileId(
  block: OrbitContentBlock,
): string | undefined {
  return ids.get(block);
}

/** Bounded credential-scoped image cache. Uploads explicitly expire after one hour. */
export class DeepSeekImageFiles {
  private readonly cache = new Map<string, { id: string; expiresAt: number }>();

  /** Forget stale references; remote uploads expire independently. */
  clear(): void {
    this.cache.clear();
  }

  /** Project image blocks into ephemeral file references without changing stored history. */
  async prepare(input: ModelChatInput, key: string): Promise<ModelChatInput> {
    const signal = input.abortSignal
      ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000);
    const messages = [];
    for (const message of input.messages) {
      const content: OrbitContentBlock[] = [];
      for (const block of message.content) {
        if (block.type !== "image") {
          content.push(block);
          continue;
        }
        signal.throwIfAborted();
        if (block.data.length > 44 * 1024 * 1024)
          throw new Error("Image exceeds inline fallback limits.");
        // The credential keys a transient content MAC; it is never stored as a password digest.
        const digest = createHmac("sha256", key)
          .update(block.mediaType)
          .update("\0")
          .update(block.data)
          .digest("hex");
        let cached = this.cache.get(digest);
        if (!cached || cached.expiresAt <= Date.now() + 60_000) {
          const bytes = Buffer.from(block.data, "base64");
          if (bytes.length > 32 * 1024 * 1024)
            throw new Error("Image exceeds inline fallback limits.");
          const form = new FormData();
          form.set(
            "file",
            new Blob([bytes], { type: block.mediaType }),
            `image.${block.mediaType.split("/")[1]}`,
          );
          form.set("purpose", "user_data");
          form.set("expires_after[anchor]", "created_at");
          form.set("expires_after[seconds]", "3600");
          const response = await fetch("https://api.deepseek.com/files", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: form,
            redirect: "error",
            signal,
          });
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            throw new Error("DeepSeek image upload unavailable.");
          }
          const file = FileResponse.parse(
            JSON.parse(
              await readResponseTextWithinLimit(
                response,
                64 * 1024,
                "File upload response",
              ),
            ),
          );
          signal.throwIfAborted();
          cached = {
            id: file.id,
            expiresAt: Math.min(
              Date.now() + 3600_000,
              (file.expires_at ?? Infinity) * 1000,
            ),
          };
          if (cached.expiresAt <= Date.now() + 60_000)
            throw new Error("Uploaded image is already expired.");
          this.cache.delete(digest);
          while (this.cache.size >= 32)
            this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(digest, cached);
        }
        const projected = { ...block };
        ids.set(projected, cached.id);
        content.push(projected);
      }
      messages.push({ ...message, content });
    }
    return { ...input, messages };
  }
}
