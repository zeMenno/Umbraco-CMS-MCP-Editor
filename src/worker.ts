/**
 * Cloudflare Worker Entry Point (legacy hosted path).
 *
 * Prefer the Azure Container Apps host (`src/hosted/azure/server.ts`) for new
 * deployments. This Worker remains for existing Cloudflare installs and e2e
 * that still use Wrangler until fully migrated.
 *
 * Uses the same tool collections as the stdio entry point (index.ts)
 * but runs over Streamable HTTP with OAuth authentication.
 */

import { tracing } from "cloudflare:workers";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import OAuthProvider from "@cloudflare/workers-oauth-provider";

import {
  createDefaultHandler,
  createSiteRoutingApiHandler,
  createWorkerExport,
  createPerRequestServer,
  getServerOptions,
  type HostedMcpEnv,
  type AuthProps,
} from "@umbraco-cms/mcp-hosted";
import { umbracoCloudSiteRouting } from "@umbraco-cms/mcp-hosted/cloud";

import { createEditorHostedOptions } from "./hosted/server-options.js";
import { registerCmsChainedServer } from "./umbraco-api/cms-chained-server.js";
import { applyWorkerDryRun } from "./config/worker-dry-run.js";
import { loadCmsCollections, needsCmsCollections } from "./umbraco-api/cms-collections-loader.js";

type EditorMcpEnv = HostedMcpEnv & { UMBRACO_DRY_RUN?: string };

const options = createEditorHostedOptions({
  // Legacy Cloudflare Cloud multi-tenant routing (not used on Azure).
  siteRouting: umbracoCloudSiteRouting({
    oauthClientId: "umbraco-cms-editor-mcp-hosted",
  }),
  telemetry: { tracing },
});

const serverOptions = getServerOptions(options);

export class UmbracoMcpAgent extends McpAgent<EditorMcpEnv, unknown, AuthProps> {
  server!: McpServer;

  async init() {
    let sessionId: string | undefined;
    try {
      sessionId = this.getSessionId?.();
    } catch (error) {
      console.warn("[mcp-hosted] could not read MCP session id for telemetry:", error);
      sessionId = undefined;
    }
    this.server = await createPerRequestServer(
      serverOptions,
      this.env,
      this.props!,
      sessionId,
    );
    applyWorkerDryRun(this.env);
    await registerCmsChainedServer();
  }
}

const provider = new OAuthProvider({
  apiRoute: ["/mcp", "/at/"],
  apiHandler: createSiteRoutingApiHandler(
    UmbracoMcpAgent.serve("/mcp", { binding: "MCP_AGENT" }),
  ),
  defaultHandler: createDefaultHandler(options) as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

const workerExport = createWorkerExport(provider, options);

export default {
  async fetch(request: Request, env: HostedMcpEnv, ctx: ExecutionContext): Promise<Response> {
    const consentToolSelection = options.enableConsentToolSelection ?? env.ENABLE_CONSENT_TOOL_SELECTION === "true";
    if (needsCmsCollections(new URL(request.url).pathname, consentToolSelection)) {
      try {
        await loadCmsCollections();
      } catch (error) {
        console.error("[editor-mcp] Failed to load @umbraco-cms/mcp-dev collections:", error);
      }
    }
    return workerExport.fetch(request, env, ctx);
  },
};
