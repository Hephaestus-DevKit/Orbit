import { supportsOrbitBrowser } from "../webui/WebUiBrowserLauncher.js";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { sanitizeLocalWebUiUrl } from "../webui/WebUiSecurity.js";

const Reply = z.object({
  id: z.number().int().positive(),
  data: z.unknown().optional(),
  error: z.string().max(240).optional(),
}).strict();
export const PageObservation = z.object({
  site: z.string().max(2048),
  title: z.string().max(160),
  controls: z.array(
    z.object({ id: z.uuid(), label: z.string().max(120), role: z.enum(["link", "button"]) })
      .strict(),
  ).max(48),
}).strict();
type Command =
  | { action: "start"; workspace: string; language: string; address?: string }
  | { action: "focus"; address?: string }
  | { action: "revoke" | "observe" }
  | { action: "click"; target: string };
type Pending = { id: number; settle: (error?: Error, data?: unknown) => void };

/** One private child pipe belongs to one running workspace and chat. */
export class OrbitBrowserSession {
  private pending?: Pending;
  private sequence = 0;
  private buffer = "";
  private child?: ChildProcessWithoutNullStreams;

  public async start(workspace: string, language: string, address?: string): Promise<void> {
    if (!supportsOrbitBrowser() || !sanitizeLocalWebUiUrl(workspace))
      throw Error("Orbit Browser requires a local macOS 14 or later desktop session.");
    const relative = "Orbit Browser.app/Contents/MacOS/OrbitBrowser";
    const base = import.meta.url.endsWith(".ts") ? "../../../dist/" : "./";
    const executable = fileURLToPath(new URL(base + relative, import.meta.url));
    if (!existsSync(executable)) throw Error("Orbit Browser is missing from this installation.");
    const child = spawn(executable, [], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG,
        PATH: "/usr/bin:/bin",
      },
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(chunk));
    child.stderr.resume();
    child.stdin.on("error", () => this.close());
    child.once("error", () => this.close());
    child.once("exit", () => this.close());
    await this.request({ action: "start", workspace, language, address });
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 131072) return this.close();
    for (let end = this.buffer.indexOf("\n"); end >= 0; end = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      try {
        const reply = Reply.parse(JSON.parse(line));
        if (reply.id !== this.pending?.id) return this.close();
        this.pending.settle(reply.error ? Error(reply.error) : undefined, reply.data);
      } catch {
        return this.close();
      }
    }
  }

  public get open(): boolean {
    return this.child !== undefined;
  }

  public request(command: Command, signal?: AbortSignal): Promise<unknown> {
    const child = this.child;
    if (!child || signal?.aborted)
      return Promise.reject(Error("Orbit Browser is closed or the action was cancelled."));
    if (this.pending) return Promise.reject(Error("Orbit Browser is handling another action."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => this.close();
      const timer = setTimeout(abort, command.action === "start" ? 15000 : 7000);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending = {
        id,
        settle: (error, data) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          this.pending = undefined;
          if (error) reject(error);
          else resolve(data);
        },
      };
      child.stdin.write(JSON.stringify({ ...command, id }) + "\n");
    });
  }

  public close(): void {
    const child = this.child;
    this.child = undefined;
    this.pending?.settle(Error("Orbit Browser closed before completing the action."));
    this.buffer = "";
    if (child) {
      child.stdin.destroy();
      child.kill();
    }
  }
}
