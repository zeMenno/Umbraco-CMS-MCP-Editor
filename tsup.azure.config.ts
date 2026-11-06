import { defineConfig } from "tsup";

/**
 * Azure Container Apps host bundle.
 * Load with: node --import ./src/hosted/hooks/register-cloudflare-shim.mjs ./dist-azure/server.js
 */
export default defineConfig({
  entry: {
    server: "src/hosted/azure/server.ts",
  },
  outDir: "dist-azure",
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  minify: false,
  dts: false,
  // Resolved at runtime via the Node import hook.
  external: ["cloudflare:workers", "ioredis"],
  noExternal: [
    "@umbraco-cms/mcp-hosted",
    "@umbraco-cms/mcp-server-sdk",
    "@umbraco-cms/mcp-dev",
    "@cloudflare/workers-oauth-provider",
  ],
});
