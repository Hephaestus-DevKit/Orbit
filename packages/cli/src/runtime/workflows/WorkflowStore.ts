import { closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  readBoundedRegularFile,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";
import { WorkflowRunSchema, type WorkflowRun } from "./WorkflowSchema.js";

const Owner = z.object({
  pid: z.number().int().positive(),
  token: z.string().uuid(),
});
/** Atomic local state. Constructors do not touch disk. */
export class WorkflowStore {
  constructor(private readonly cwd: string) {}

  private directory(): string {
    return resolveSafePath(this.cwd, ".orbit/workflow-runs");
  }
  private path(id: string): string {
    WorkflowRunSchema.shape.id.parse(id);
    return resolveSafePath(this.cwd, `${this.directory()}/${id}.json`);
  }
  read(id: string): WorkflowRun {
    const raw = readBoundedRegularFile(this.path(id), 1024 * 1024);
    if (!raw) throw new Error(`Workflow run ${id} was not found.`);
    return WorkflowRunSchema.parse(JSON.parse(raw));
  }
  save(run: WorkflowRun): void {
    const checked = WorkflowRunSchema.parse(run);
    mkdirSync(this.directory(), { recursive: true });
    replacePrivateFileAtomically(
      this.path(run.id),
      JSON.stringify(checked, null, 2),
    );
  }
  /** Hold one workspace-wide owner across all asynchronous stages. */
  acquire(recover: boolean): () => void {
    mkdirSync(this.directory(), { recursive: true });
    const lock = resolveSafePath(this.cwd, `${this.directory()}/owner.json`);
    const token = randomUUID();
    // Serialize acquisition and stale-owner recovery across processes. A crashed
    // recovery guard is deliberately manual recovery rather than an unsafe steal.
    const guard = resolveSafePath(
      this.cwd,
      `${this.directory()}/recovery.lock`,
    );
    let guardFd: number;
    try {
      guardFd = openSync(guard, "wx", 0o600);
    } catch {
      throw new Error(
        "Workflow ownership is being updated. Retry; if its process crashed, inspect recovery.lock before manual recovery.",
      );
    }
    const create = () => {
      const fd = openSync(lock, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      } finally {
        closeSync(fd);
      }
    };
    try {
      try {
        create();
      } catch (error: unknown) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "EEXIST"
          )
        )
          throw error;
        const raw = readBoundedRegularFile(lock, 4096);
        const owner = Owner.safeParse(raw ? JSON.parse(raw) : undefined);
        if (!owner.success)
          throw new Error(
            "Workflow lock is unreadable; inspect .orbit/workflow-runs/owner.json before manual recovery.",
          );
        let alive = true;
        try {
          process.kill(owner.data.pid, 0);
        } catch (failure: unknown) {
          alive = !(
            failure &&
            typeof failure === "object" &&
            "code" in failure &&
            failure.code === "ESRCH"
          );
        }
        if (alive || !recover)
          throw new Error(
            "A workflow owner is active or interrupted. Wait for it, or explicitly resume after its process exits.",
          );
        // Synchronous recovery; never steal from a live owner or malformed record.
        if (readBoundedRegularFile(lock, 4096) !== raw)
          throw new Error("Workflow owner changed; retry resume.");
        unlinkSync(lock);
        create();
      }
    } finally {
      closeSync(guardFd);
      unlinkSync(guard);
    }
    return () => {
      const raw = readBoundedRegularFile(lock, 4096);
      if (raw && Owner.parse(JSON.parse(raw)).token === token) unlinkSync(lock);
    };
  }
}
