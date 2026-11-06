/**
 * Streamable HTTP MCP apiHandler for the Azure Node host.
 *
 * Replaces the Cloudflare Durable Object `McpAgent.serve("/mcp")` path:
 * authenticated requests from OAuthProvider land here with `ctx.props`.
 */

import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createPerRequestServer,
  getServerOptions,
  type AuthProps,
  type HostedMcpEnv,
  type HostedMcpServerOptions,
} from "@umbraco-cms/mcp-hosted";
import { applyWorkerDryRun } from "../config/worker-dry-run.js";
import { registerCmsChainedServer } from "../umbraco-api/cms-chained-server.js";
import { loadCmsCollections } from "../umbraco-api/cms-collections-loader.js";

type SessionRecord = {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
};

export function createMcpApiHandler(options: HostedMcpServerOptions) {
  const serverOptions = getServerOptions(options);
  const sessions = new Map<string, SessionRecord>();

  async function ensureCmsLoaded(): Promise<void> {
    await loadCmsCollections();
  }

  async function fetch(
    request: Request,
    env: HostedMcpEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const props = (ctx as ExecutionContext & { props?: AuthProps }).props;
    if (!props?.umbracoTokenKey) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sessionIdHeader = request.headers.get("mcp-session-id");

    if (request.method === "DELETE" && sessionIdHeader) {
      const existing = sessions.get(sessionIdHeader);
      if (existing) {
        await existing.transport.close().catch(() => undefined);
        sessions.delete(sessionIdHeader);
      }
      return new Response(null, { status: 204 });
    }

    if (sessionIdHeader && sessions.has(sessionIdHeader)) {
      const session = sessions.get(sessionIdHeader)!;
      return session.transport.handleRequest(request);
    }

    if (request.method === "POST") {
      let body: unknown;
      try {
        body = await request.clone().json();
      } catch {
        return new Response(JSON.stringify({ error: "invalid_json" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const isInit =
        (Array.isArray(body) && body.some((message) => isInitializeRequest(message))) ||
        isInitializeRequest(body);

      if (!isInit) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID provided" },
            id: null,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      await ensureCmsLoaded();

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      applyWorkerDryRun(env as { UMBRACO_DRY_RUN?: string });
      const server = await createPerRequestServer(serverOptions, env, props, undefined);
      await registerCmsChainedServer();
      await server.connect(transport);

      const response = await transport.handleRequest(request);

      const sessionId = transport.sessionId;
      if (sessionId) {
        sessions.set(sessionId, { transport, server });
        transport.onclose = () => {
          sessions.delete(sessionId);
        };
      }

      return response;
    }

    return new Response("Method Not Allowed", { status: 405 });
  }

  return { fetch };
}
