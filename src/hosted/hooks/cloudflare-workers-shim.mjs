/**
 * Runtime shim for `cloudflare:workers` under Node.
 * Loaded via the resolve hook in resolve-cloudflare-workers.mjs.
 */
export class WorkerEntrypoint {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch() {
    throw new Error("WorkerEntrypoint.fetch is not implemented in the Azure Node shim");
  }
}

export const tracing = {
  startSpan() {
    return {
      setAttribute() {},
      end() {},
    };
  },
};
