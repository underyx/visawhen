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
  ]),
  ...nextConfig,
]);
