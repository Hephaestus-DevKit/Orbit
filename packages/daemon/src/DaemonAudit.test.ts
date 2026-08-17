import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { DaemonAuditLog } from "./DaemonAudit.js";

describe("DaemonAuditLog", () => {
  it("writes and verifies a bounded hash chain", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-audit-"));
    const log = new DaemonAuditLog("audit/events.jsonl", root);
    expect(log.initialize()).toMatchObject({ valid: true, entries: 0 });
    log.append({
      principalId: "alice",
      authMethod: "jwt",
      action: "task.submit",
      outcome: "accepted",
      metadata: { prompt: "use sk-abcdefghijklmnopqrstuvwxyz1234567890" },
    });
    log.append({
      principalId: "alice",
      authMethod: "jwt",
      action: "task.cancel",
      outcome: "denied",
    });
    expect(log.verify()).toMatchObject({ valid: true, entries: 2 });
    expect(log.read()).toHaveLength(2);
    expect(
      readFileSync(join(root, "audit/events.jsonl"), "utf8"),
    ).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("rejects tampering before accepting more entries", () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-audit-"));
    const path = join(root, "events.jsonl");
    const log = new DaemonAuditLog("events.jsonl", root);
    log.initialize();
    log.append({
      principalId: "alice",
      authMethod: "bearer",
      action: "health",
      outcome: "accepted",
    });
    const raw = readFileSync(path, "utf8").replace("health", "shutdown");
    writeFileSync(path, raw);
    expect(log.verify().valid).toBe(false);
    expect(() =>
      log.append({
        principalId: "alice",
        authMethod: "bearer",
        action: "health",
        outcome: "accepted",
      }),
    ).toThrow();
  });
});
