import { Writable } from 'node:stream';
import { buildApp, type BuildAppOptions } from '../../app.js';
import { type PiAuth } from '../../auth/pi-credential.js';
import { loadConfig } from '../../config.js';
import type { ToolCallRecord } from '../../core/tool-calls.js';
import type { RegisteredTool } from '../../core/tool-registry.js';
import { createLogger } from '../../logging.js';
import type { BackendModule } from '../../modules.js';
import { createPiRoutes } from '../routes.js';
import { azureToolPrefix, createRemoteMcpBridge, githubToolPrefix, type RemoteMcpBridge } from '../remote-mcp.js';
import { createPiTurnRegistry, type PiTurnRegistry } from '../turns.js';
import { coreGroup } from './groups/core.testkit.js';
import { factoryGroup } from './groups/factory.testkit.js';
import { googleGroup } from './groups/google.testkit.js';
import { healthGroup } from './groups/health.testkit.js';
import { notesGroup } from './groups/notes.testkit.js';
import { pcGroup } from './groups/pc.testkit.js';
import { piGroup } from './groups/pi.testkit.js';
import { workspaceGroup } from './groups/workspace.testkit.js';
import { createConformanceAuth, createMcpClient, type McpClient } from './mcp-client.testkit.js';
import { createStubMcpServer, stubAzureTools, stubGithubTools, type StubServer } from './remote.testkit.js';
import { createConformanceConversations } from './shared.testkit.js';
import type { ConformanceContext, ConformanceGroup, GroupFactory } from './types.testkit.js';

/** Every group, in the order modules are composed. A new production module must be claimed by one of them (`covers`). */
export const allGroups: readonly GroupFactory[] = [
  coreGroup, notesGroup, factoryGroup, googleGroup, healthGroup, pcGroup, workspaceGroup, piGroup,
];

export const defaultOwnerMessage = 'Please do that now.';

export interface ConformanceWorld {
  readonly app: ReturnType<typeof buildApp>;
  readonly context: ConformanceContext;
  readonly groups: readonly ConformanceGroup[];
  /** Every registered tool, including the ones chat does not see. */
  readonly tools: readonly RegisteredTool[];
  readonly registry: PiTurnRegistry;
  readonly auth: PiAuth;
  readonly client: McpClient;
  readonly bridges: readonly RemoteMcpBridge[];
  readonly remote: { readonly github: StubServer; readonly azure: StubServer };
  /** Tool calls the dispatcher recorded, by tool name. */
  readonly recorded: ToolCallRecord[];
  /** What tools threw, as the tool itself threw it (the dispatcher only shows "Tool execution failed" for an untyped throw). */
  readonly thrown: { readonly tool: string; readonly error: unknown }[];
  /** Backend log lines of level warn and above produced while the world ran. */
  readonly warnings: Record<string, unknown>[];
  close(): Promise<void>;
}

const ownerToken = 'owner.token.fixture';

/** Merge the buildApp options of several groups; two groups (or a group and the world) supplying the same one is a composition error. */
function mergeAppOptions(groups: readonly ConformanceGroup[], shared: Partial<BuildAppOptions>): Partial<BuildAppOptions> {
  const merged: Record<string, unknown> = { ...shared };
  for (const group of groups) {
    for (const [key, value] of Object.entries(group.appOptions ?? {})) {
      if (key in merged) throw new Error(`Conformance group "${group.id}" supplies buildApp option "${key}", which another group or the world already supplies.`);
      merged[key] = value;
    }
  }
  return merged as Partial<BuildAppOptions>;
}

/**
 * The whole backend, offline: every production module composed from the groups' stubs, the real PI MCP door in front of the
 * real tool routes, and stub GitHub and Azure MCP servers behind the real bridges.
 */
export async function buildConformanceWorld(options: { readonly groups?: readonly GroupFactory[] } = {}): Promise<ConformanceWorld> {
  const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
  const context: ConformanceContext = {
    config, owner: config.auth.ownerObjectId, down: new Set(),
    ownerMessage: { text: defaultOwnerMessage, id: '42', sessionId: '7' },
  };
  const groups = (options.groups ?? allGroups).map((factory) => factory(context));

  const registry = createPiTurnRegistry();
  const auth = createConformanceAuth(config.auth.tenantId);
  const github = createStubMcpServer(stubGithubTools, { sse: true });
  const azure = createStubMcpServer(stubAzureTools);
  const bridges = [
    createRemoteMcpBridge({ url: 'https://github.example/mcp', prefix: githubToolPrefix, label: 'GitHub', token: async () => 'stub-token', fetch: github.fetch }),
    createRemoteMcpBridge({ url: 'https://azure.example/mcp', prefix: azureToolPrefix, label: 'Azure', token: async () => 'stub-token', fetch: azure.fetch }),
  ];
  const door: BackendModule = {
    id: 'pi-door', tools: [],
    registerRoutes: createPiRoutes({
      gateway: { stream: async function* () {}, status: async () => ({ enabled: true }) } as never,
      registry, auth, monthlyCapDkk: 250, bridges,
    }),
  };

  const recorded: ToolCallRecord[] = [];
  const thrown: ConformanceWorld['thrown'] = [];
  const watched = (module: BackendModule): BackendModule => ({
    ...module,
    tools: module.tools.map((tool) => ({
      ...tool,
      execute: async (...args: Parameters<typeof tool.execute>) => {
        try { return await tool.execute(...args); } catch (error) { thrown.push({ tool: tool.name, error }); throw error; }
      },
    })),
  });
  const warnings: Record<string, unknown>[] = [];
  const log = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        try {
          const record = JSON.parse(line) as Record<string, unknown>;
          if (typeof record.level === 'number' && record.level >= 40 && warnings.length < 500) warnings.push(record);
        } catch { /* not a JSON log line */ }
      }
      done();
    },
  });
  const app = buildApp(config, createLogger({ logLevel: 'info' }, undefined, log), {
    ...mergeAppOptions(groups, { conversationStore: createConformanceConversations(context) }),
    // The suite tests tools, not HTTP routes: only the core module keeps its routes because they include the tool dispatcher.
    modules: [...groups.flatMap((group) => group.modules).map((module) => watched(module.id === 'core' ? module : { ...module, registerRoutes: async () => {} })), door],
    auth: async (token) => {
      if (token !== ownerToken) throw new Error('rejected');
      return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' };
    },
    toolCallStore: { record: async (call) => { recorded.push(call); } },
    piAuth: auth,
  });
  await app.ready();

  const client = createMcpClient({
    app, registry, auth, owner: context.owner, sessionId: context.ownerMessage.sessionId, messageId: context.ownerMessage.id,
  });
  return {
    app, context, groups, tools: app.jarvisTools.list(), registry, auth, client, bridges, remote: { github, azure }, recorded, thrown, warnings,
    async close() {
      await app.close();
      for (const group of groups) await group.close?.();
    },
  };
}
