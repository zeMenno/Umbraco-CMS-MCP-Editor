/**
 * Builds a HostedMcpEnv for the Azure Node host from process.env.
 */

import type { HostedMcpEnv } from "@umbraco-cms/mcp-hosted";
import { createOAuthKv } from "./kv/oauth-kv.js";

export type AzureHostedEnv = HostedMcpEnv & {
  UMBRACO_DRY_RUN?: string;
  REDIS_URL?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Stub Durable Object binding — unused on Azure (sessions live in-process). */
const stubDurableObjectNamespace = {
  idFromName() {
    throw new Error("Durable Objects are not available on the Azure Node host");
  },
  idFromString() {
    throw new Error("Durable Objects are not available on the Azure Node host");
  },
  get() {
    throw new Error("Durable Objects are not available on the Azure Node host");
  },
  newUniqueId() {
    throw new Error("Durable Objects are not available on the Azure Node host");
  },
} as unknown as DurableObjectNamespace;

/**
 * Loads Azure hosted env bindings. Call once at process start.
 */
export async function loadAzureHostedEnv(): Promise<AzureHostedEnv & { close?: () => Promise<void> }> {
  const oauthKv = await createOAuthKv(process.env.REDIS_URL);

  // Hosted OAuth client id (OpenIddict); fall back to a common local default.
  const oauthClientId =
    process.env.UMBRACO_OAUTH_CLIENT_ID ||
    process.env.UMBRACO_CLIENT_ID ||
    "umbraco-editor-mcp-hosted";

  const env: AzureHostedEnv & { close?: () => Promise<void> } = {
    UMBRACO_BASE_URL: requireEnv("UMBRACO_BASE_URL"),
    UMBRACO_SERVER_URL: process.env.UMBRACO_SERVER_URL,
    UMBRACO_OAUTH_CLIENT_ID: oauthClientId,
    UMBRACO_OAUTH_CLIENT_SECRET:
      process.env.UMBRACO_OAUTH_CLIENT_SECRET || process.env.UMBRACO_CLIENT_SECRET,
    COOKIE_ENCRYPTION_KEY: (() => {
      if (process.env.COOKIE_ENCRYPTION_KEY) return process.env.COOKIE_ENCRYPTION_KEY;
      if (process.env.NODE_ENV === "production") {
        return requireEnv("COOKIE_ENCRYPTION_KEY");
      }
      console.warn(
        "[azure-mcp] COOKIE_ENCRYPTION_KEY unset; using insecure dev default (set it in .env for real use)",
      );
      return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    })(),
    OAUTH_KV: oauthKv,
    MCP_AGENT: stubDurableObjectNamespace,
    // Injected by OAuthProvider on each request; placeholder satisfies the type.
    OAUTH_PROVIDER: undefined as unknown as HostedMcpEnv["OAUTH_PROVIDER"],
    UMBRACO_TOOL_MODES: process.env.UMBRACO_TOOL_MODES,
    UMBRACO_INCLUDE_SLICES: process.env.UMBRACO_INCLUDE_SLICES,
    UMBRACO_EXCLUDE_SLICES: process.env.UMBRACO_EXCLUDE_SLICES,
    UMBRACO_READONLY: process.env.UMBRACO_READONLY,
    UMBRACO_EXPECTED_MAJOR: process.env.UMBRACO_EXPECTED_MAJOR,
    ENABLE_CONSENT_TOOL_SELECTION: process.env.ENABLE_CONSENT_TOOL_SELECTION,
    ENABLE_INFO_ENDPOINT: process.env.ENABLE_INFO_ENDPOINT,
    TENANT_HASH_KEY: process.env.TENANT_HASH_KEY,
    LOGIN_SESSION_HASH_KEY: process.env.LOGIN_SESSION_HASH_KEY,
    LOG_AUTH: process.env.LOG_AUTH,
    UMBRACO_DRY_RUN: process.env.UMBRACO_DRY_RUN,
    REDIS_URL: process.env.REDIS_URL,
    close: () => oauthKv.close?.() ?? Promise.resolve(),
  };

  return env;
}

/** Minimal ExecutionContext for OAuthProvider under Node. */
export function createExecutionContext(): ExecutionContext & { props?: unknown } {
  return {
    waitUntil(promise: Promise<unknown>) {
      void promise.catch((error) => {
        console.error("[azure-mcp] waitUntil task failed:", error);
      });
    },
    passThroughOnException() {},
    props: undefined,
  } as unknown as ExecutionContext & { props?: unknown };
}
