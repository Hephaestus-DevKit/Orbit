import { extname } from "path";
import ts from "typescript";
import type { SymbolEntry } from "./SymbolIndexer.js";

export type IndexedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "cpp"
  | "sql"
  | "text";

export interface ParsedSourceFile {
  language: IndexedLanguage;
  symbols: SymbolEntry[];
  imports: string[];
}

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JAVASCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const PYTHON_EXTENSIONS = new Set([".py", ".pyw"]);
const GENERIC_LANGUAGE_BY_EXTENSION: Record<string, IndexedLanguage> = {
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".c": "cpp",
  ".h": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".sql": "sql",
  ".md": "text",
  ".mdx": "text",
  ".json": "text",
  ".yaml": "text",
  ".yml": "text",
  ".toml": "text",
  ".sh": "text",
  ".bash": "text",
  ".ps1": "text",
  ".css": "text",
  ".scss": "text",
};

/** Extensions covered by the symbol graph and hybrid repository search. */
export const INDEXED_SOURCE_GLOB =
  "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,pyw,go,rs,java,cs,c,h,cc,cpp,cxx,hpp,sql,md,mdx,sh,bash,ps1,css,scss}";

/** Parse one supported source file through its language-specific frontend. */
export function parseSourceFile(
  content: string,
  filePath: string,
): ParsedSourceFile {
  const extension = extname(filePath).toLowerCase();
  if (PYTHON_EXTENSIONS.has(extension)) {
    return parsePythonSource(content);
  }
  if (
    TYPESCRIPT_EXTENSIONS.has(extension) ||
    JAVASCRIPT_EXTENSIONS.has(extension)
  ) {
    return parseTypeScriptSource(
      content,
      filePath,
      TYPESCRIPT_EXTENSIONS.has(extension) ? "typescript" : "javascript",
    );
  }
  const genericLanguage = GENERIC_LANGUAGE_BY_EXTENSION[extension];
  if (genericLanguage) return parseGenericSource(content, genericLanguage);
  throw new Error(`Unsupported source extension "${extension}".`);
}

function parseGenericSource(
  content: string,
  language: IndexedLanguage,
): ParsedSourceFile {
  if (language === "text") return { language, symbols: [], imports: [] };
  const symbols: SymbolEntry[] = [];
  const imports: string[] = [];
  const declarationPatterns: Array<[SymbolEntry["type"], RegExp]> =
    language === "go"
      ? [
          ["function", /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/],
          ["type", /^\s*type\s+([A-Za-z_]\w*)\s+/],
          ["constant", /^\s*const\s+([A-Za-z_]\w*)\b/],
        ]
      : language === "rust"
        ? [
            ["function", /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\b/],
            ["class", /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)\b/],
            ["type", /^\s*(?:pub\s+)?(?:enum|type)\s+([A-Za-z_]\w*)\b/],
            ["interface", /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)\b/],
            ["constant", /^\s*(?:pub\s+)?const\s+([A-Za-z_]\w*)\b/],
          ]
        : language === "sql"
          ? [
              [
                "type",
                /^\s*create\s+(?:or\s+replace\s+)?(?:table|view)\s+([\w.]+)/i,
              ],
              [
                "function",
                /^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+([\w.]+)/i,
              ],
            ]
          : [
              [
                "class",
                /^\s*(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|abstract\s+|final\s+)*class\s+([A-Za-z_]\w*)\b/,
              ],
              [
                "interface",
                /^\s*(?:public\s+|private\s+|protected\s+|internal\s+)*interface\s+([A-Za-z_]\w*)\b/,
              ],
              [
                "type",
                /^\s*(?:public\s+|private\s+|protected\s+|internal\s+)*(?:enum|record|struct)\s+([A-Za-z_]\w*)\b/,
              ],
            ];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    for (const [type, pattern] of declarationPatterns) {
      const match = pattern.exec(line);
      if (match?.[1]) {
        symbols.push({ name: match[1], type, line: index + 1 });
        break;
      }
    }
    const importMatch =
      language === "go"
        ? /^\s*import\s+(?:[A-Za-z_]+\s+)?["`]([^"`]+)["`]/.exec(line)
        : language === "rust"
          ? /^\s*use\s+([^;]+);/.exec(line)
          : /^\s*(?:import|using|#include)\s+[<"]?([^;>"]+)/.exec(line);
    if (importMatch?.[1]) imports.push(importMatch[1].trim());
  }
  return {
    language,
    symbols: deduplicateSymbols(symbols),
    imports: Array.from(new Set(imports)),
  };
}

function parseTypeScriptSource(
  content: string,
  filePath: string,
  language: "typescript" | "javascript",
): ParsedSourceFile {
  const symbols: SymbolEntry[] = [];
  const imports: string[] = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (ts.isStringLiteral(specifier)) imports.push(specifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = node.moduleSpecifier;
      if (ts.isStringLiteral(specifier)) imports.push(specifier.text);
    } else if (ts.isClassDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, type: "class", line: lineOf(node) });
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      symbols.push({
        name: node.name.text,
        type: "interface",
        line: lineOf(node),
      });
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, type: "type", line: lineOf(node) });
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({
        name: node.name.text,
        type: "function",
        line: lineOf(node),
      });
    } else if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (isExported) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            symbols.push({
              name: declaration.name.text,
              type: "constant",
              line: lineOf(declaration),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { language, symbols, imports };
}

function parsePythonSource(content: string): ParsedSourceFile {
  const symbols: SymbolEntry[] = [];
  const imports: string[] = [];
  let tripleQuote: "'''" | '\"\"\"' | undefined;

  for (const [lineIndex, rawLine] of content.split(/\r?\n/).entries()) {
    const sanitized = sanitizePythonLine(rawLine, tripleQuote);
    tripleQuote = sanitized.tripleQuote;
    const code = sanitized.code.trim();
    if (!code) continue;

    const classMatch = /^(?:class)\s+([A-Za-z_]\w*)\b/.exec(code);
    if (classMatch) {
      symbols.push({ name: classMatch[1], type: "class", line: lineIndex + 1 });
      continue;
    }
    const functionMatch = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\b/.exec(code);
    if (functionMatch) {
      symbols.push({
        name: functionMatch[1],
        type: "function",
        line: lineIndex + 1,
      });
      continue;
    }

    if (/^\S/.test(sanitized.code)) {
      const constantMatch = /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/.exec(code);
      if (constantMatch) {
        symbols.push({
          name: constantMatch[1],
          type: "constant",
          line: lineIndex + 1,
        });
      }
    }

    const fromMatch = /^from\s+(\.*[A-Za-z_]\w*(?:\.\w+)*|\.+)\s+import\b/.exec(
      code,
    );
    if (fromMatch) {
      imports.push(fromMatch[1]);
      continue;
    }
    const importMatch = /^import\s+(.+)$/.exec(code);
    if (importMatch) {
      for (const entry of importMatch[1].split(",")) {
        const moduleName = entry.trim().split(/\s+as\s+/i)[0];
        if (/^[A-Za-z_]\w*(?:\.\w+)*$/.test(moduleName)) {
          imports.push(moduleName);
        }
      }
    }
  }

  return {
    language: "python",
    symbols: deduplicateSymbols(symbols),
    imports: Array.from(new Set(imports)),
  };
}

interface SanitizedPythonLine {
  code: string;
  tripleQuote?: "'''" | '\"\"\"';
}

/** Remove comments and strings while preserving declaration indentation. */
function sanitizePythonLine(
  line: string,
  activeTripleQuote?: "'''" | '\"\"\"',
): SanitizedPythonLine {
  let code = "";
  let quote: "'" | '\"' | undefined;
  let tripleQuote = activeTripleQuote;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    if (tripleQuote) {
      if (line.startsWith(tripleQuote, index)) {
        index += 2;
        tripleQuote = undefined;
      }
      continue;
    }
    const character = line[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      code += " ";
      continue;
    }
    if (line.startsWith("'''", index) || line.startsWith('\"\"\"', index)) {
      tripleQuote = line.startsWith("'''", index) ? "'''" : '\"\"\"';
      index += 2;
      continue;
    }
    if (character === "#") break;
    if (character === "'" || character === '\"') {
      quote = character;
      code += " ";
      continue;
    }
    code += character;
  }
  return { code, tripleQuote };
}

function deduplicateSymbols(symbols: SymbolEntry[]): SymbolEntry[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.type}:${symbol.name}:${symbol.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
