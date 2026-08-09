import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getEmbeddingProvider,
  SymbolIndexer,
  SymbolIndexSchema,
} from "./SymbolIndexer.js";
import { HybridSearch } from "./HybridSearch.js";

describe("SymbolIndexer tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `orbit-symbol-indexer-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Create a mock orbit config in target dir
    const configContent = `
name: test-project
context:
  ignore:
    - node_modules/**
    - dist/**
`;
    writeFileSync(join(tempDir, "orbit.config.yaml"), configContent, "utf8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("falls back to lexical search for the official DeepSeek API", () => {
    const provider = getEmbeddingProvider({
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: "deepseek-test-key",
        },
      },
    });

    expect(provider).toBeNull();
  });

  it("never assumes a missing compatible base URL has embeddings", () => {
    const provider = getEmbeddingProvider({
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          apiKey: "deepseek-test-key",
        },
      },
    });

    expect(provider).toBeNull();
  });

  it("honors a separately selected compatible embedding provider", () => {
    const provider = getEmbeddingProvider({
      provider: {
        default: "deepseek-openai",
        embedding: "private-embeddings",
      },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKey: "deepseek-test-key",
        },
        "private-embeddings": {
          type: "openai-compatible",
          baseUrl: "https://embeddings.example.com/v1",
          apiKey: "embedding-test-key",
        },
      },
    });

    expect(provider?.type).toBe("openai");
  });

  it("uses a separately configured OpenAI provider for embeddings", () => {
    const provider = getEmbeddingProvider({
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKey: "deepseek-test-key",
        },
        "openai-embeddings": {
          type: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "openai-test-key",
        },
      },
    });

    expect(provider).not.toBeNull();
    expect(provider?.type).toBe("openai");
  });

  it("does not auto-select an unrelated Ollama fallback", () => {
    const provider = getEmbeddingProvider({
      provider: { default: "deepseek-openai" },
      providers: {
        "deepseek-openai": {
          type: "openai-compatible",
          baseUrl: "https://api.deepseek.com",
          apiKey: "deepseek-test-key",
        },
        ollama: {
          type: "ollama",
          baseUrl: "http://localhost:11434",
        },
      },
    });

    expect(provider).toBeNull();
  });

  it("allows Ollama when it is the active embedding provider", () => {
    const active = getEmbeddingProvider({
      provider: { default: "ollama" },
      providers: {
        ollama: {
          type: "ollama",
          baseUrl: "http://localhost:11434",
        },
      },
    });
    const explicit = getEmbeddingProvider({
      provider: { default: "deepseek-openai", embedding: "ollama" },
      providers: {
        ollama: {
          type: "ollama",
          baseUrl: "http://localhost:11434",
        },
      },
    });

    expect(active?.type).toBe("ollama");
    expect(explicit?.type).toBe("ollama");
  });

  it("deduplicates concurrent indexing for the same workspace", async () => {
    let releaseIndex!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });
    const prototype = SymbolIndexer.prototype as unknown as {
      performIndex(): Promise<void>;
    };
    const performIndex = vi
      .spyOn(prototype, "performIndex")
      .mockImplementation(() => gate);

    try {
      const first = new SymbolIndexer(tempDir).index();
      const second = new SymbolIndexer(tempDir).index();

      expect(performIndex).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);

      releaseIndex();
      await Promise.all([first, second]);

      await new SymbolIndexer(tempDir).index();
      expect(performIndex).toHaveBeenCalledTimes(2);
    } finally {
      releaseIndex();
      performIndex.mockRestore();
    }
  });

  it(
    "should parse class, interface, function, and constants and cache them in symbols.json",
    { timeout: 60000 },
    async () => {
      const srcDir = join(tempDir, "src");
      mkdirSync(srcDir, { recursive: true });

      const code = `
// This is a comment class IgnoredClass
export class User {
  constructor(public name: string) {}
}

export interface AuthDetails {
  token: string;
}

export type Status = 'active' | 'inactive';

export async function login(user: User): Promise<boolean> {
  return true;
}

export const API_URL = 'http://localhost';
`;
      writeFileSync(join(srcDir, "index.ts"), code, "utf8");

      const indexer = new SymbolIndexer(tempDir);
      await indexer.index();

      const indexPath = join(tempDir, ".orbit", "symbols.json");
      expect(existsSync(indexPath)).toBe(true);

      const raw = readFileSync(indexPath, "utf8");
      const index = SymbolIndexSchema.parse(JSON.parse(raw));

      const fileIndex = index.files["src/index.ts"];
      expect(fileIndex).toBeDefined();
      expect(fileIndex.symbols.length).toBe(5);

      const names = fileIndex.symbols.map((symbol) => symbol.name);
      expect(names).toContain("User");
      expect(names).toContain("AuthDetails");
      expect(names).toContain("Status");
      expect(names).toContain("login");
      expect(names).toContain("API_URL");

      // Test Search
      const searchRes = await indexer.search("auth");
      expect(searchRes.length).toBe(1);
      expect(searchRes[0].name).toBe("AuthDetails");
      expect(searchRes[0].filePath).toBe("src/index.ts");
      expect(searchRes[0].type).toBe("interface");
    },
  );

  it(
    "indexes Python symbols and makes their chunks searchable",
    { timeout: 60000 },
    async () => {
      const packageDir = join(tempDir, "forecast");
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        join(packageDir, "models.py"),
        `class DemandForecast:\n    pass\n`,
        "utf8",
      );
      writeFileSync(
        join(packageDir, "solver.py"),
        `from .models import DemandForecast\n\nMAX_CAPACITY = 60\n\ndef optimize_schedule(data):\n    return DemandForecast()\n`,
        "utf8",
      );

      const indexer = new SymbolIndexer(tempDir);
      await indexer.index();

      const index = SymbolIndexSchema.parse(
        JSON.parse(
          readFileSync(join(tempDir, ".orbit", "symbols.json"), "utf8"),
        ),
      );
      expect(index.version).toBe(2);
      expect(index.files["forecast/solver.py"]).toMatchObject({
        language: "python",
        imports: [".models"],
        symbols: expect.arrayContaining([
          expect.objectContaining({ name: "MAX_CAPACITY", type: "constant" }),
          expect.objectContaining({
            name: "optimize_schedule",
            type: "function",
          }),
        ]),
      });
      await expect(indexer.search("DemandForecast")).resolves.toEqual([
        expect.objectContaining({
          name: "DemandForecast",
          filePath: "forecast/models.py",
        }),
      ]);

      const hybridSearch = new HybridSearch(tempDir);
      await expect(
        hybridSearch.search(
          "optimize schedule capacity",
          async () => {
            throw new Error("lexical-only test");
          },
          { limit: 5 },
        ),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({
              filePath: "forecast/solver.py",
            }),
          }),
        ]),
      );
    },
  );

  it(
    "should incrementally update, clean up deleted files, and respect ignore lists",
    { timeout: 60000 },
    async () => {
      const srcDir = join(tempDir, "src");
      mkdirSync(srcDir, { recursive: true });

      writeFileSync(join(srcDir, "a.ts"), "export class A {}", "utf8");
      writeFileSync(join(srcDir, "b.ts"), "export class B {}", "utf8");

      const indexer = new SymbolIndexer(tempDir);
      await indexer.index();

      const indexPath = join(tempDir, ".orbit", "symbols.json");
      let raw = readFileSync(indexPath, "utf8");
      let index = JSON.parse(raw);
      expect(Object.keys(index.files).length).toBe(2);

      // 1. Delete b.ts and run indexer again
      rmSync(join(srcDir, "b.ts"));
      await indexer.index();

      raw = readFileSync(indexPath, "utf8");
      index = JSON.parse(raw);
      expect(Object.keys(index.files).length).toBe(1);
      expect(index.files["src/a.ts"]).toBeDefined();
      expect(index.files["src/b.ts"]).toBeUndefined();
    },
  );

  it(
    "should parse imports, compute PageRank, and generate a token-bounded repo map",
    { timeout: 60000 },
    async () => {
      const srcDir = join(tempDir, "src");
      mkdirSync(srcDir, { recursive: true });

      // File A imports B
      const codeA = `
import { B } from './b.js';
export class A {
  useB() { return new B(); }
}
`;
      // File B imports C
      const codeB = `
import { C } from './c.js';
export class B {
  useC() { return new C(); }
}
`;
      // File C has no imports but is imported by B
      const codeC = `
export class C {
  hello() { console.log('hello'); }
}
`;

      writeFileSync(join(srcDir, "a.ts"), codeA, "utf8");
      writeFileSync(join(srcDir, "b.ts"), codeB, "utf8");
      writeFileSync(join(srcDir, "c.ts"), codeC, "utf8");

      const indexer = new SymbolIndexer(tempDir);
      await indexer.index();

      const indexPath = join(tempDir, ".orbit", "symbols.json");
      const raw = readFileSync(indexPath, "utf8");
      const index = JSON.parse(raw);

      // Verify imports are captured
      expect(index.files["src/a.ts"].imports).toContain("./b.js");
      expect(index.files["src/b.ts"].imports).toContain("./c.js");
      expect(index.files["src/c.ts"].imports).toEqual([]);

      // Generate full repo map
      const fullMap = await indexer.getRepoMapText(10000);
      expect(fullMap).toContain("Detailed Landmarks");
      expect(fullMap).toContain("src/c.ts");
      expect(fullMap).toContain("src/b.ts");
      expect(fullMap).toContain("src/a.ts");

      // Generate token-constrained repo map (low budget)
      // Should show at least one detailed landmark, or fall back
      const smallMap = await indexer.getRepoMapText(30);
      expect(smallMap).toBeDefined();

      // Generate medium budget repo map to verify outlined landmarks degradation
      const mediumMap = await indexer.getRepoMapText(150);
      expect(mediumMap).toBeDefined();
      expect(mediumMap).toContain("Landmark");
    },
  );

  it("should respect gitignore rules by calling git ls-files if available", async () => {
    const { execSync } = await import("child_process");
    try {
      execSync("git init", { cwd: tempDir, stdio: "ignore" });
      execSync("git config user.name 'Test'", {
        cwd: tempDir,
        stdio: "ignore",
      });
      execSync("git config user.email 'test@test.com'", {
        cwd: tempDir,
        stdio: "ignore",
      });
    } catch {
      // Git is not available in test environment, skip test
      return;
    }

    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });

    const trackedFile = join(srcDir, "tracked.ts");
    const ignoredFile = join(srcDir, "ignored.ts");

    writeFileSync(trackedFile, "export class Tracked {}", "utf8");
    writeFileSync(ignoredFile, "export class Ignored {}", "utf8");

    writeFileSync(join(tempDir, ".gitignore"), "src/ignored.ts\n", "utf8");

    const indexer = new SymbolIndexer(tempDir);
    await indexer.index();

    const indexPath = join(tempDir, ".orbit", "symbols.json");
    expect(existsSync(indexPath)).toBe(true);

    const raw = readFileSync(indexPath, "utf8");
    const index = JSON.parse(raw);

    expect(index.files["src/tracked.ts"]).toBeDefined();
    expect(index.files["src/ignored.ts"]).toBeUndefined();
  }, 20_000);

  it("does not index files above the configured size boundary", async () => {
    writeFileSync(
      join(tempDir, "orbit.config.yaml"),
      "context:\n  maxFileSizeKb: 1\n",
      "utf8",
    );
    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "small.ts"), "export const small = 1;", "utf8");
    writeFileSync(
      join(srcDir, "large.ts"),
      `export const large = "${"x".repeat(2048)}";`,
      "utf8",
    );

    await new SymbolIndexer(tempDir).index();

    const parsed = SymbolIndexSchema.parse(
      JSON.parse(readFileSync(join(tempDir, ".orbit", "symbols.json"), "utf8")),
    );
    expect(parsed.files["src/small.ts"]).toBeDefined();
    expect(parsed.files["src/large.ts"]).toBeUndefined();
  });

  it("rebuilds search caches when a persisted cache is malformed", async () => {
    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "recover.ts"),
      "export class RecoveryTarget {}",
      "utf8",
    );
    await new SymbolIndexer(tempDir).index();
    writeFileSync(join(tempDir, ".orbit", "bm25_store.json"), "{bad", "utf8");

    await new SymbolIndexer(tempDir).index();

    const results = await new HybridSearch(tempDir).search(
      "RecoveryTarget",
      async () => {
        throw new Error("lexical-only test");
      },
    );
    expect(
      results.some((result) => result.metadata.filePath === "src/recover.ts"),
    ).toBe(true);
  });
});
