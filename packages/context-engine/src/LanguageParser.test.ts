import { describe, expect, it } from "vitest";
import { parseSourceFile } from "./LanguageParser.js";

describe("LanguageParser", () => {
  it("parses Python declarations, constants, and dependency imports", () => {
    const parsed = parseSourceFile(
      `
"""Module docs containing a fake declaration:
def ignored():
    pass
"""
import numpy as np, pandas
from .models import Forecast
from ..shared.units import normalize

MAX_ITERATIONS: int = 50
lowercase_value = 2

class Solver:
    async def solve(self) -> float:
        return 1.0

def build_model() -> Solver:
    return Solver()
`,
      "solver.py",
    );

    expect(parsed.language).toBe("python");
    expect(parsed.imports).toEqual([
      "numpy",
      "pandas",
      ".models",
      "..shared.units",
    ]);
    expect(parsed.symbols).toEqual([
      { name: "MAX_ITERATIONS", type: "constant", line: 10 },
      { name: "Solver", type: "class", line: 13 },
      { name: "solve", type: "function", line: 14 },
      { name: "build_model", type: "function", line: 17 },
    ]);
  });

  it("keeps the TypeScript frontend behavior behind the shared interface", () => {
    const parsed = parseSourceFile(
      `import { load } from "./loader.js";
export interface Config { enabled: boolean }
export class Runner {}
export function run() { return load(); }
export const VERSION = "1";`,
      "runner.ts",
    );

    expect(parsed.language).toBe("typescript");
    expect(parsed.imports).toEqual(["./loader.js"]);
    expect(parsed.symbols.map((symbol) => symbol.name)).toEqual([
      "Config",
      "Runner",
      "run",
      "VERSION",
    ]);
  });
});
