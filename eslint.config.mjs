import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "functions/lib/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent sessions' git worktrees, with their own builds inside: not this
    // checkout's code, and 2,588 errors of build output (UAT, 2026-10-09).
    ".claude/**",
  ]),
]);

export default eslintConfig;
