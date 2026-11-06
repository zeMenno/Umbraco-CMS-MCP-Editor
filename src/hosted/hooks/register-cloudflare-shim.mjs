/**
 * Node module customization hook so `@cloudflare/workers-oauth-provider`
 * can resolve `cloudflare:workers` under plain Node (Azure Container Apps).
 *
 * Usage: node --import ./src/hosted/hooks/register-cloudflare-shim.mjs …
 */
import { register } from "node:module";

register("./resolve-cloudflare-workers.mjs", import.meta.url);
