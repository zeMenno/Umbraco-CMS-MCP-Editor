/**
 * Hosted MCP lifecycle for E2E tests.
 *
 * Prefers the Azure Node host (`startAzureHost`). Set `HOSTED_E2E_RUNTIME=wrangler`
 * to use the legacy Cloudflare Worker via Wrangler unstable_dev.
 */

import { startAzureHost, stopAzureHost, getAzureHostUrl } from "./azure-setup.js";

export type HostedRuntime = "azure" | "wrangler";

function resolveRuntime(): HostedRuntime {
  const value = (process.env.HOSTED_E2E_RUNTIME ?? "azure").toLowerCase();
  return value === "wrangler" ? "wrangler" : "azure";
}

let runtime: HostedRuntime = "azure";
let workerUrl: string | undefined;

export async function startWorker(varsOverride?: Record<string, string>): Promise<string> {
  runtime = resolveRuntime();

  if (runtime === "azure") {
    workerUrl = await startAzureHost(varsOverride);
    return workerUrl;
  }

  const { unstable_dev } = await import("wrangler");
  const worker = await unstable_dev("src/worker.ts", {
    config: "tests/hosted-e2e/wrangler.e2e.toml",
    port: 8787,
    experimental: { disableExperimentalWarning: true },
    vars: {
      UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL ?? "https://localhost:44386",
      UMBRACO_SERVER_URL: process.env.UMBRACO_SERVER_URL ?? "http://localhost:53620",
      UMBRACO_OAUTH_CLIENT_ID: "umbraco-editor-mcp-hosted",
      COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ENABLE_INFO_ENDPOINT: "true",
      ...varsOverride,
    },
    logLevel: "error",
  });

  (globalThis as { __e2eWranglerWorker?: typeof worker }).__e2eWranglerWorker = worker;
  workerUrl = `http://${worker.address}:${worker.port}`;
  return workerUrl;
}

export async function stopWorker(): Promise<void> {
  if (runtime === "azure") {
    await stopAzureHost();
    workerUrl = undefined;
    return;
  }

  const worker = (globalThis as { __e2eWranglerWorker?: { stop: () => Promise<void> } })
    .__e2eWranglerWorker;
  if (worker) {
    await worker.stop();
    delete (globalThis as { __e2eWranglerWorker?: unknown }).__e2eWranglerWorker;
  }
  workerUrl = undefined;
}

export function getWorkerUrl(): string {
  if (runtime === "azure") {
    return getAzureHostUrl();
  }
  if (!workerUrl) {
    throw new Error("Worker not started. Call startWorker() first.");
  }
  return workerUrl;
}
