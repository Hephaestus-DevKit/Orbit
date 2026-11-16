import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "output/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: {
    // Sanitized boundary errors intentionally omit raw causes containing credentials.
    "preserve-caught-error": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": [
        "warn",
        {
            "argsIgnorePattern": "^_"
        }
    ],
    "@typescript-eslint/no-require-imports": "off",
    "@typescript-eslint/no-empty-object-type": "off",
    "@typescript-eslint/no-unsafe-function-type": "off",
    "no-undef": "off",
    "no-empty": "off",
    "no-constant-condition": "off",
    "no-control-regex": "off",
    "no-useless-escape": "off",
    "prefer-const": "warn",
    "no-ex-assign": "warn"
} },
];
