import nextConfig from "eslint-config-next";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    ".next/**",
    ".pnp.cjs",
    ".pnp.loader.mjs",
    ".yarn/**",
    "out/**",
    "next-env.d.ts",
    // the data scrapers' Python environments (Jupyter ships JavaScript)
    "data/**/.venv/**",
  ]),
  ...nextConfig,
  {
    // The .ts modules are loaded by Node as they are in `yarn test` (see
    // scripts/ts-hooks.mjs), which strips types but keeps every import, so
    // an import of a type alone has to say so.
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
    },
  },
]);
