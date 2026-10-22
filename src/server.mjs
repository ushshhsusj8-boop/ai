import { createGatewayServer } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { hydrateProviderModels } from "./model_catalog.mjs";
import { createSharedConversationStore } from "./shared_conversations.mjs";
import { createSharedReplica } from "./shared_replica.mjs";
import { createWorkspaceSettings } from "./workspace_settings.mjs";
import { createAccountStore } from './accounts.mjs';
import { dirname, join } from 'node:path';

const baseConfig = loadConfig();
const workspaceStore = createWorkspaceSettings(baseConfig, { file: './secrets/workspace-settings.enc', keyFile: './secrets/workspace-master.key' });
const config = workspaceStore.config;
workspaceStore.updateCatalog(await hydrateProviderModels(config, workspaceStore.fetch));
const localSharedStore = config.sharedConversationsFile
  ? createSharedConversationStore(config.sharedConversationsFile)
  : undefined;
const sharedStore = localSharedStore && config.sharedSyncUrl
  ? createSharedReplica(localSharedStore, { url: config.sharedSyncUrl,
    token: config.sharedSyncToken || config.gatewayAccessToken,
    queueFile: `${config.sharedConversationsFile}.sync-queue.json` })
  : localSharedStore;
const accountStore = createAccountStore(config.accountStoreFile || (config.sharedConversationsFile ? join(dirname(config.sharedConversationsFile), 'accounts.json') : './data/accounts.json'));
const server = createGatewayServer({ config, sharedStore, workspaceStore, accountStore, fetchImpl: workspaceStore.fetch });

server.listen(config.port, config.bindHost, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "server_started",
    port: config.port,
    bindHost: config.bindHost,
    localDevNoAuth: config.localDevNoAuth,
    defaultProvider: config.defaultProvider,
    providers: Object.keys(config.providers),
  }));
});

function shutdown(signal) {
  sharedStore?.close?.();
  workspaceStore.close();
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
