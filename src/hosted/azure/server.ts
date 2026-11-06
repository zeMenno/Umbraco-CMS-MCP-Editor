/**
 * Azure Container Apps entry — single-tenant hosted MCP over Streamable HTTP.
 *
 * Replaces Cloudflare Worker Durable Objects + KV with:
 * - In-process MCP sessions (Streamable HTTP)
 * - Redis (or memory) OAuth KV via createOAuthKv
 *
 * Requires: node --import ./src/hosted/hooks/register-cloudflare-shim.mjs
 * so `@cloudflare/workers-oauth-provider` can resolve `cloudflare:workers`.
 */

import "dotenv/config";
import { createServer } from "node:http";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
  createDefaultHandler,
  createWorkerExport,
  type HostedMcpEnv,
} from "@umbraco-cms/mcp-hosted";
import { createEditorHostedOptions } from "../server-options.js";
import { createMcpApiHandler } from "../mcp-api-handler.js";
import { createExecutionContext, loadAzureHostedEnv } from "../env.js";
import { nodeRequestToFetch, writeFetchResponse } from "../http-adapter.js";
import {
  loadCmsCollections,
  needsCmsCollections,
} from "../../umbraco-api/cms-collections-loader.js";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main(): Promise<void> {
  const env = await loadAzureHostedEnv();
  const options = createEditorHostedOptions();
  const mcpApiHandler = createMcpApiHandler(options);

  const provider = new OAuthProvider({
    apiRoute: "/mcp",
    // OAuthProvider's ExportedHandler typing is Cloudflare-specific; cast at the boundary.
    apiHandler: mcpApiHandler as never,
    defaultHandler: createDefaultHandler(options) as never,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
  });

  const workerExport = createWorkerExport(provider, options);

  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/health" || req.url === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      const host = req.headers.host ?? `localhost:${PORT}`;
      const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
      const request = await nodeRequestToFetch(req, `${proto}://${host}`);
      const pathname = new URL(request.url).pathname;

      const consentToolSelection =
        options.enableConsentToolSelection ?? env.ENABLE_CONSENT_TOOL_SELECTION === "true";
      if (needsCmsCollections(pathname, consentToolSelection)) {
        try {
          await loadCmsCollections();
        } catch (error) {
          console.error("[azure-mcp] Failed to load @umbraco-cms/mcp-dev collections:", error);
        }
      }

      const ctx = createExecutionContext();
      const response = await workerExport.fetch(request, env as HostedMcpEnv, ctx);
      await writeFetchResponse(response, res);
    } catch (error) {
      console.error("[azure-mcp] request failed:", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "internal_error" }));
      } else {
        res.destroy();
      }
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[azure-mcp] listening on http://${HOST}:${PORT}`);
    console.log(`[azure-mcp] MCP endpoint: http://${HOST}:${PORT}/mcp`);
    console.log(`[azure-mcp] Umbraco: ${env.UMBRACO_BASE_URL}`);
  });

  const shutdown = async () => {
    console.log("[azure-mcp] shutting down…");
    server.close();
    await env.close?.();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error("[azure-mcp] failed to start:", error);
  process.exit(1);
});
