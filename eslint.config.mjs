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
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // These patterns (resetting state when props change, timer setup) are
      // intentional and work correctly. Downgrade to warning until the
      // codebase is refactored to use React 19 idioms.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
