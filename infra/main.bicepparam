using './main.bicep'

param namePrefix = 'umbraco-mcp-editor'
param location = 'westeurope'
param umbracoBaseUrl = 'https://umbraco.example.com'
param umbracoOauthClientId = 'umbraco-editor-mcp-hosted'
param containerImage = 'YOUR_ACR.azurecr.io/umbraco-mcp-editor:latest'

// Provide at deploy time:
// az deployment group create ... --parameters cookieEncryptionKey=$(openssl rand -hex 32)
param cookieEncryptionKey = ''
