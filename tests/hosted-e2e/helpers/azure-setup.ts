/**
 * Azure / Node hosted MCP lifecycle for E2E tests.
 *
 * Starts `dist-azure/server.js` (built via `npm run build:azure`) with the
 * Cloudflare workers shim import hook. Falls back to building if the bundle
 * is missing.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const serverJs = resolve(root, "dist-azure/server.js");
const shim = resolve(root, "src/hosted/hooks/register-cloudflare-shim.mjs");

let child: ChildProcess | undefined;
let serverUrl: string | undefined;

const BASE_ENV = {
  UMBRACO_BASE_URL: process.env.UMBRACO_BASE_URL ?? "https://localhost:44386",
  UMBRACO_SERVER_URL: process.env.UMBRACO_SERVER_URL ?? "http://localhost:53620",
  UMBRACO_OAUTH_CLIENT_ID: "umbraco-editor-mcp-hosted",
  COOKIE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ENABLE_INFO_ENDPOINT: "true",
  HOST: "127.0.0.1",
  PORT: "8080",
};

async function waitForHealth(url: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Azure MCP host did not become healthy at ${url}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function startAzureHost(envOverride?: Record<string, string>): Promise<string> {
  if (!existsSync(serverJs)) {
    throw new Error(
      `Missing ${serverJs}. Run \`npm run build:azure\` before hosted e2e tests.`,
    );
  }

  const port = envOverride?.PORT ?? BASE_ENV.PORT;
  const host = envOverride?.HOST ?? BASE_ENV.HOST;
  serverUrl = `http://${host}:${port}`;

  child = spawn(
    process.execPath,
    ["--import", shim, serverJs],
    {
      cwd: root,
      env: { ...process.env, ...BASE_ENV, ...envOverride },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("[azure-mcp]") || text.includes("Error")) {
      console.error(text.trimEnd());
    }
  });

  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`[azure-setup] host exited code=${code} signal=${signal}`);
    }
  });

  await waitForHealth(serverUrl);
  return serverUrl;
}

export async function stopAzureHost(): Promise<void> {
  if (!child) return;
  const proc = child;
  child = undefined;
  serverUrl = undefined;
  proc.kill("SIGTERM");
  await new Promise<void>((resolveDone) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolveDone();
    }, 5_000);
    proc.on("exit", () => {
      clearTimeout(timer);
      resolveDone();
    });
  });
}

export function getAzureHostUrl(): string {
  if (!serverUrl) {
    throw new Error("Azure host not started. Call startAzureHost() first.");
  }
  return serverUrl;
}
