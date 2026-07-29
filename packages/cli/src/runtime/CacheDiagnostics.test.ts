import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCacheDiagnostics } from "./CacheDiagnostics.js";

describe("CacheDiagnostics", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports cache slab churn without requiring prompt contents", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-cache-diagnostics-"));
    dirs.push(cwd);
    const slabDir = join(cwd, ".orbit", "cache-slabs");
    mkdirSync(slabDir, { recursive: true });
    writeFileSync(
      join(slabDir, "new.json"),
      JSON.stringify({
        hash: "new",
        model: "deepseek-v4-flash",
        tokenEstimate: 1200,
        lastPrimedAt: "2026-07-01T00:01:00.000Z",
        telemetry: [
          {
            recordedAt: "2026-07-01T00:02:00.000Z",
            inputTokens: 1000,
            hitTokens: 900,
            missTokens: 100,
            hitRate: 0.9,
            degraded: false,
          },
        ],
      }),
    );
    writeFileSync(
      join(slabDir, "old.json"),
      JSON.stringify({
        hash: "old",
        model: "deepseek-v4-flash",
        tokenEstimate: 1000,
        lastPrimedAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    const report = buildCacheDiagnostics(cwd);

    expect(report).toContain("Cache slab churn: 2 retained");
    expect(report).toContain("stable delta +200t");
    expect(report).toContain("hash changed");
    expect(report).not.toContain("stable prefix");
  });

  it("ignores oversized cache metadata", () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-cache-diagnostics-"));
    dirs.push(cwd);
    const slabDir = join(cwd, ".orbit", "cache-slabs");
    mkdirSync(slabDir, { recursive: true });
    writeFileSync(join(slabDir, "oversized.json"), "x".repeat(256 * 1024 + 1));

    expect(buildCacheDiagnostics(cwd)).toContain(
      "No readable cache slab metadata",
    );
  });
});
