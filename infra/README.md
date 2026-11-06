# Azure infrastructure (single-tenant MCP)

Deploys:

- Container Apps environment + app (Node MCP host)
- Azure Cache for Redis (OAuth / session KV)
- Key Vault (cookie encryption secret placeholder)
- Log Analytics

```bash
az group create -n umbraco-mcp-editor-rg -l westeurope

az deployment group create \
  -g umbraco-mcp-editor-rg \
  -f main.bicep \
  -p main.bicepparam \
  cookieEncryptionKey="$(openssl rand -hex 32)" \
  containerImage="myacr.azurecr.io/umbraco-mcp-editor:latest" \
  umbracoBaseUrl="https://umbraco.example.com"
```

After deploy, set `MCP_HOSTED_URL` on the Umbraco site to the `containerAppUrl` output and restart Umbraco so `McpOAuthComposer` registers redirect URIs.
