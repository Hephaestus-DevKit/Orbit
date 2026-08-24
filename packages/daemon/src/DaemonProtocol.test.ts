import { describe, expect, it } from "vitest";
import {
  DaemonTaskRecordSchema,
  deriveDaemonFailureMetadata,
} from "./DaemonProtocol.js";

describe("daemon failure receipts", () => {
  it("distinguish cancellation, runner errors, exit failures, and lease loss", () => {
    expect(deriveDaemonFailureMetadata("canceled")).toMatchObject({
      failureCode: "canceled",
      retryable: false,
    });
    expect(
      deriveDaemonFailureMetadata("failed", { error: "boom" }),
    ).toMatchObject({
      failureCode: "runner_error",
      retryable: true,
    });
    expect(
      deriveDaemonFailureMetadata("failed", { exitCode: 1 }),
    ).toMatchObject({
      failureCode: "nonzero_exit",
      retryable: true,
    });
    expect(deriveDaemonFailureMetadata("orphaned")).toMatchObject({
      failureCode: "lease_expired",
      retryable: true,
    });
  });

  it("keeps the durable record schema backward-compatible with old v1 records", () => {
    const parsed = DaemonTaskRecordSchema.parse({
      schemaVersion: 1,
      id: "task_0123456789abcdef0123456789abcdef",
      cwd: "C:/workspace",
      prompt: "inspect",
      options: {},
      state: "queued",
      attempt: 1,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
      eventCount: 0,
    });
    expect(parsed.failureCode).toBeUndefined();
  });
});
