import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ProviderProfileStore } from "./ProviderProfiles.js";

describe("ProviderProfileStore", () => {
  let orbitDir: string;

  beforeEach(() => {
    orbitDir = mkdtempSync(join(tmpdir(), "orbit-providers-test-"));
  });

  afterEach(() => {
    rmSync(orbitDir, { recursive: true, force: true });
  });

  it("stores provider metadata, selects it, and deletes it", () => {
    const store = new ProviderProfileStore({ orbitDir, platform: "linux" });
    store.upsert({
      id: "tokendance",
      name: "TokenDance",
      config: {
        type: "openai-compatible",
        baseUrl: "https://tokendance.space/gateway/v1",
        apiKeyEnv: "TOKENDANCE_API_KEY",
        models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      },
    });
    store.setActive("tokendance");

    expect(store.read()).toMatchObject({
      activeProvider: "tokendance",
      profiles: [
        expect.objectContaining({ id: "tokendance", name: "TokenDance" }),
      ],
    });
    expect(
      readFileSync(join(orbitDir, "providers.json"), "utf8"),
    ).not.toContain("sk-private");

    expect(store.delete("tokendance")?.id).toBe("tokendance");
    expect(store.read()).toEqual({ version: 1, profiles: [] });
  });

  it("rejects unsafe IDs and unknown active providers", () => {
    const store = new ProviderProfileStore({ orbitDir, platform: "linux" });
    expect(() =>
      store.upsert({
        id: "../unsafe",
        name: "Unsafe",
        config: { type: "openai-compatible" },
      }),
    ).toThrow();
    expect(() => store.setActive("missing")).toThrow(
      "Provider profile not found",
    );
  });

  it("migrates unversioned metadata and recovers the last good snapshot", () => {
    const profilePath = join(orbitDir, "providers.json");
    writeFileSync(profilePath, JSON.stringify({ profiles: [] }), "utf8");
    const store = new ProviderProfileStore({ orbitDir, platform: "linux" });
    expect(store.read()).toEqual({ version: 1, profiles: [] });

    store.upsert({
      id: "deepseek",
      name: "DeepSeek",
      config: { type: "openai-compatible" },
    });
    store.setActive("deepseek");
    writeFileSync(profilePath, "{broken", "utf8");

    expect(store.read().profiles).toEqual([
      expect.objectContaining({ id: "deepseek" }),
    ]);
  });

  it("refuses an unsafe backup without changing the active profile file", () => {
    const store = new ProviderProfileStore({ orbitDir, platform: "linux" });
    store.upsert({
      id: "first",
      name: "First",
      config: { type: "openai-compatible" },
    });
    const profilePath = join(orbitDir, "providers.json");
    const before = readFileSync(profilePath, "utf8");
    mkdirSync(`${profilePath}.bak`);

    expect(() =>
      store.upsert({
        id: "second",
        name: "Second",
        config: { type: "openai-compatible" },
      }),
    ).toThrow("regular file");
    expect(readFileSync(profilePath, "utf8")).toBe(before);
  });

  it("bounds profile snapshots and falls back to a valid backup", () => {
    const store = new ProviderProfileStore({ orbitDir, platform: "linux" });
    store.upsert({
      id: "safe",
      name: "Safe",
      config: { type: "openai-compatible" },
    });
    store.setActive("safe");
    const profilePath = join(orbitDir, "providers.json");
    writeFileSync(profilePath, "x".repeat(1024 * 1024 + 1));

    expect(store.read()).toMatchObject({
      profiles: [expect.objectContaining({ id: "safe" })],
    });
  });
});
