import js from "@eslint/js";

// JavaScript keeps ESLint's recommended checks. TypeScript and the shared
// TypeScript-aware rules are checked by Oxlint via scripts/lint.mjs.
export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "output/**", "coverage/**"] },
  js.configs.recommended,
  {
    rules: {
      "preserve-caught-error": "off",
      "no-undef": "off",
      "no-empty": "off",
      "no-constant-condition": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-unused-vars": ["warn", {argsIgnorePattern:"^_"}],
      "prefer-const": "warn",
      "no-ex-assign": "warn",
    },
  },
];
