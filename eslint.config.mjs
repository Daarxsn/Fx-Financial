import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local agent tooling can live inside a developer's checkout but is not part
    // of the invoice application and must not be included in the project lint.
    "hive/**",
  ]),
]);

export default eslintConfig;
