@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Base name used for resource naming')
param namePrefix string = 'umbraco-mcp-editor'

@description('Umbraco Management API base URL (HTTPS)')
param umbracoBaseUrl string

@description('OpenIddict client id registered in Umbraco')
param umbracoOauthClientId string = 'umbraco-editor-mcp-hosted'

@secure()
@description('32-byte hex cookie encryption key (openssl rand -hex 32)')
param cookieEncryptionKey string

@secure()
@description('Optional Umbraco OAuth client secret')
param umbracoOauthClientSecret string = ''

@description('Container image (ACR or public)')
param containerImage string

@description('CPU cores for the Container App')
param cpu string = '0.5'

@description('Memory for the Container App')
param memory string = '1Gi'

var redisName = '${namePrefix}-redis'
var kvName = take(replace('${namePrefix}-kv${uniqueString(resourceGroup().id)}', '-', ''), 24)
var logName = '${namePrefix}-logs'
var envName = '${namePrefix}-env'
var appName = '${namePrefix}-app'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enabledForDeployment: false
    enabledForTemplateDeployment: true
  }
}

resource cookieSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'COOKIE-ENCRYPTION-KEY'
  properties: {
    value: cookieEncryptionKey
  }
}

resource umbracoSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(umbracoOauthClientSecret)) {
  parent: keyVault
  name: 'UMBRACO-OAUTH-CLIENT-SECRET'
  properties: {
    value: umbracoOauthClientSecret
  }
}

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: redisName
  location: location
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisConfiguration: {
      'maxmemory-policy': 'volatile-lru'
    }
  }
}

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'cookie-encryption-key'
          value: cookieEncryptionKey
        }
        {
          name: 'redis-url'
          value: 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:6380'
        }
        {
          name: 'umbraco-oauth-client-secret'
          value: empty(umbracoOauthClientSecret) ? 'unused' : umbracoOauthClientSecret
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'mcp'
          image: containerImage
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: [
            { name: 'PORT', value: '8080' }
            { name: 'HOST', value: '0.0.0.0' }
            { name: 'UMBRACO_BASE_URL', value: umbracoBaseUrl }
            { name: 'UMBRACO_OAUTH_CLIENT_ID', value: umbracoOauthClientId }
            { name: 'ENABLE_INFO_ENDPOINT', value: 'true' }
            {
              name: 'COOKIE_ENCRYPTION_KEY'
              secretRef: 'cookie-encryption-key'
            }
            {
              name: 'REDIS_URL'
              secretRef: 'redis-url'
            }
            {
              name: 'UMBRACO_OAUTH_CLIENT_SECRET'
              secretRef: 'umbraco-oauth-client-secret'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 8080 }
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 8080 }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output mcpEndpoint string = 'https://${containerApp.properties.configuration.ingress.fqdn}/mcp'
output keyVaultName string = keyVault.name
output redisHostName string = redis.properties.hostName
