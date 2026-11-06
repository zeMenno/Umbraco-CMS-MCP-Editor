/**
 * Resolves the bare specifier `cloudflare:workers` to our Node shim.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const shimUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "cloudflare-workers-shim.mjs"),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      shortCircuit: true,
      url: shimUrl,
    };
  }
  return nextResolve(specifier, context);
}
