/**
 * Shared HostedMcpServerOptions for Cloudflare Worker and Azure Node hosts.
 * Single-tenant only — Cloud /at/{alias}/ routing is not wired on Azure.
 */

import type {
  ChainedServerConsentConfig,
  HostedMcpServerOptions,
} from "@umbraco-cms/mcp-hosted";
import { collections, allModes, allModeNames, allSliceNames } from "../collections.js";
import { SERVER_INSTRUCTIONS } from "../server-instructions.js";
import {
  getLoadedCmsCollections,
} from "../umbraco-api/cms-collections-loader.js";
import packageJson from "../../package.json" with { type: "json" };

const cmsChainedServer: ChainedServerConsentConfig = {
  name: "cms",
  displayName: "umbraco-cms-mcp",
  get modeRegistry() {
    return getLoadedCmsCollections().allModes;
  },
  get collections() {
    return getLoadedCmsCollections().collections;
  },
  get allModeNames() {
    return getLoadedCmsCollections().allModeNames;
  },
  get allSliceNames() {
    return getLoadedCmsCollections().allSliceNames;
  },
};

export function createEditorHostedOptions(
  extras?: Partial<HostedMcpServerOptions>,
): HostedMcpServerOptions {
  return {
    name: "umbraco-cms-editor-mcp-hosted",
    version: packageJson.version,
    expectedUmbracoMajor: packageJson.version.split(".")[0],
    instructions: SERVER_INSTRUCTIONS,
    collections,
    modeRegistry: allModes,
    allModeNames,
    allSliceNames,
    enableConsentToolSelection: false,
    authOptions: { showReauthButton: true },
    chainedServers: [cmsChainedServer],
    ...extras,
  };
}
