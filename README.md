# umbraco-mcp-editor-cms

MCP server template for Umbraco add-ons using the @umbraco-cms/mcp-server-sdk.

## Getting Started

### System Prerequisites

- **Node.js 22+** is required. Check your version with `node --version`.

### 1. Install Dependencies

```bash
npm install
```

On first clone, run `npm run umbraco:bootstrap` to create `demo-site/` from `demo-site-template/`. Then start the CMS with `npm run start:umbraco`.

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your Umbraco connection details:

```bash
cp .env.example .env
```

### 3. Generate API Client (Optional)

If you have an OpenAPI spec for your add-on:

1. Update `orval.config.ts` to point to your spec
2. Run the generator:

```bash
npm run generate
```

### 4. Build and Test

```bash
# Build the server
npm run build

# Run tests
npm test

# Test with MCP Inspector
npm run inspect
```

## Project Structure

```
├── src/
│   ├── api/
│   │   ├── client.ts           # Axios client configuration
│   │   └── generated/          # Orval-generated API code
│   ├── tools/
│   │   └── example/            # Example tool collection
│   │       ├── get/
│   │       ├── post/
│   │       └── index.ts
│   └── index.ts                # Server entry point
├── scripts/
│   └── tunnels.sh              # Cloudflare tunnels for remote MCP client testing
├── umbraco/
│   └── McpOAuthComposer.cs     # OAuth client registration (copy into your Umbraco project)
├── __tests__/
│   └── example/                # Example tests
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── jest.config.ts
├── orval.config.ts
└── .env.example
```

## Adding Your Own Tools

1. Create a new folder under `src/tools/` for your tool collection
2. Create tool files following the example pattern:
   - `get/` for GET operations
   - `post/` for POST operations
   - `put/` for PUT operations
   - `delete/` for DELETE operations
3. Create an `index.ts` that exports the collection
4. Register the collection in `src/index.ts`

### Tool Pattern Example

```typescript
import { z } from "zod";
import {
  withStandardDecorators,
  executeGetApiCall,
  CAPTURE_RAW_HTTP_RESPONSE,
  ToolDefinition,
} from "@umbraco-cms/mcp-server-sdk";

const inputSchema = {
  id: z.string().uuid(),
};

const myTool: ToolDefinition<typeof inputSchema> = {
  name: "my-tool",
  description: "Does something useful",
  inputSchema,
  slices: ["read"],
  annotations: { readOnlyHint: true },
  handler: async ({ id }) => {
    return executeGetApiCall((client) =>
      client.getMyItem(id, CAPTURE_RAW_HTTP_RESPONSE)
    );
  },
};

export default withStandardDecorators(myTool);
```

## Testing

Tests use Jest with the MCP toolkit's testing helpers:

```typescript
import {
  setupTestEnvironment,
  createSnapshotResult,
  createMockRequestHandlerExtra,
} from "@umbraco-cms/mcp-server-sdk/testing";

describe("my-tool", () => {
  setupTestEnvironment();

  it("should do something", async () => {
    const result = await myTool.handler({ id: "..." }, createMockRequestHandlerExtra());
    expect(createSnapshotResult(result)).toMatchSnapshot();
  });
});
```

## Hosted MCP (Azure Container Apps) — preferred

Single-tenant hosted MCP for one Umbraco instance (`UMBRACO_BASE_URL`). Entry point: `src/hosted/azure/server.ts`.

```bash
# Build the Azure host bundle
npm run build:azure

# Configure (see .env.azure.example)
export UMBRACO_BASE_URL=https://your-umbraco.example.com
export UMBRACO_OAUTH_CLIENT_ID=umbraco-editor-mcp-hosted
export COOKIE_ENCRYPTION_KEY=$(openssl rand -hex 32)
# Optional: Azure Cache for Redis (in-memory if omitted)
# export REDIS_URL=rediss://:PASSWORD@NAME.redis.cache.windows.net:6380

npm run start:azure
# MCP: http://localhost:8080/mcp  Health: http://localhost:8080/health
```

**Umbraco OpenIddict:** use `demo-site-template/McpOAuthComposer.cs`. Set `MCP_HOSTED_URL` to the public Container Apps URL (e.g. `https://umbraco-mcp-editor-app.…azurecontainerapps.io`) so `/callback` and `/logout-callback` are registered.

**Docker / infra:**

```bash
docker build -t umbraco-mcp-editor:local .
az deployment group create -g <rg> -f infra/main.bicep -p infra/main.bicepparam \
  cookieEncryptionKey=$(openssl rand -hex 32) \
  containerImage=<your-acr>/umbraco-mcp-editor:tag \
  umbracoBaseUrl=https://your-umbraco.example.com
```

Connect MCP clients to `https://<container-app-fqdn>/mcp`.

Hosted e2e defaults to this Node host (`npm run build:azure && npm run test:e2e`). Set `HOSTED_E2E_RUNTIME=wrangler` for the legacy Worker.

### Legacy: Cloudflare Worker

`src/worker.ts` + `wrangler.toml` remain for existing Cloudflare deployments. Prefer Azure for new hosts. Cloud multi-tenant `/at/{alias}/` routing stays Worker-only for now.

## Publishing

1. Update `package.json` with your package name and details
2. Build: `npm run build`
3. Publish: `npm publish`

## License

MIT
