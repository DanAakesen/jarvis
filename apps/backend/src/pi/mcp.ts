import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { piMcpPath, type PiAuth } from '../auth/pi-credential.js';
import {
  createToolRegistry, isCurrentAssistantTool, isSituationActivationTool, isWakeTool, toolSchemaFieldNames,
  type JarvisTool, type RegisteredTool, type ToolCompletionContract, type ToolRegistry,
} from '../core/tool-registry.js';
import {
  normalizeCompletionText, remoteTerminalReceipt, semanticOperation,
} from '../core/tool-completion.js';
import { azureToolPrefix, githubToolPrefix, type RemoteMcpBridge } from './remote-mcp.js';
import { searchJarvisTools, shortenToolDescription } from './tool-search.js';
import { piTurnPattern, type PiTurnRegistry } from './turns.js';
import type { PiSituationService } from './situation.js';
import type { SourceId } from '../proactive/types.js';
import { completionEvidence, toolEffect } from './completion.js';
import { piConnectionInventory } from './capabilities.js';

const maxFullResults = 3;
const maxOtherResults = 5;
const maxResultCharacters = 200_000;
const notFound = 'Unknown tool, or not looked up yet. Call find_tools first, then call_tool. Nothing was done.';
const unknownTurn = 'This turn is not active, so nothing was done. Use the exact turn reference from the current message.';

const turn = z.string().regex(piTurnPattern, 'The turn reference is the jt- value from the current message.');
const findSchema = z.object({ turn, query: z.string().min(2).max(100) }).strict();
const callSchema = z.object({
  turn,
  name: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/u),
  arguments: z.record(z.string(), z.unknown()),
}).strict();

function text(value: unknown, isError = false): CallToolResult {
  const body = JSON.stringify(value);
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: body }] };
}

function remoteOperation(
  bridge: RemoteMcpBridge,
  name: string,
  args: Record<string, unknown>,
) {
  const words = normalizeCompletionText(name.slice(bridge.prefix.length)).split(/[_-]+/u).filter(Boolean);
  if (words.some(word => ['delete', 'remove', 'cancel', 'close', 'archive'].includes(word))) return 'delete' as const;
  if (words.some(word => ['send', 'comment', 'reply'].includes(word))) return 'send' as const;
  if (words.some(word => ['dispatch', 'run', 'start', 'trigger', 'retry', 'rerun'].includes(word))) return 'start' as const;
  if (words.includes('write')) {
    return ['id', 'number', 'issue', 'issueNumber', 'issue_number', 'pullNumber',
      'pull_number', 'sha', 'path'].some(field => args[field] !== undefined)
      ? 'update' as const : 'create' as const;
  }
  if (words.includes('create') && words.includes('update')) {
    return args.sha !== undefined || args.id !== undefined || args.number !== undefined
      ? 'update' as const : 'create' as const;
  }
  if (words.some(word => ['update', 'edit', 'move', 'merge', 'approve', 'ready', 'label',
    'assign', 'mark', 'reopen', 'pause', 'resume', 'pin', 'unpin'].includes(word))) return 'update' as const;
  if (words.some(word => ['create', 'add'].includes(word))) return 'create' as const;
  if (words.some(word => ['open', 'show', 'restore'].includes(word))) return 'open' as const;
  return semanticOperation(name.slice(bridge.prefix.length));
}

function compileRemoteTools(
  bridge: RemoteMcpBridge,
  tools: readonly RegisteredTool[],
): readonly RegisteredTool[] {
  const domain = bridge.prefix === githubToolPrefix ? 'github' as const
    : bridge.prefix === azureToolPrefix ? 'azure' as const : 'generic' as const;
  const contracted: JarvisTool[] = tools.map(tool => {
    const operation = (args: Record<string, unknown>) => remoteOperation(bridge, tool.name, args);
    const completion: ToolCompletionContract = {
      domain,
      operation,
      requestTargetFields: [...toolSchemaFieldNames(tool.inputSchema)],
      resultTargetFields: [
        'id', 'number', 'issueNumber', 'issue_number', 'pullNumber', 'pull_number', 'repository',
        'repo', 'owner', 'resourceId', 'resource_id', 'resourceGroup', 'resourceName', 'url',
        'html_url', 'path', 'sha', 'commit', 'branch', 'ref', 'runId', 'jobId',
        'title', 'name', 'status', 'state', 'outcome', 'created', 'updated', 'deleted', 'merged',
        'sent', 'commented', 'closed', 'archived', 'accepted', 'opened', 'dispatched',
      ],
      evaluate: (args, result) => remoteTerminalReceipt(operation(args), args, result),
    };
    return { ...tool, completion };
  });
  return createToolRegistry([{ id: `remote:${bridge.prefix}`, tools: contracted }]).list();
}

/** Chat never shows the capability-discovery operation selector; the voice and chat catalogues stay aligned. */
function shapeSchema(tool: RegisteredTool): unknown {
  if (tool.name !== 'get_system_health') return tool.inputSchema;
  const { properties, ...rest } = tool.inputSchema as { properties?: Record<string, unknown> };
  return { ...rest, properties: Object.fromEntries(Object.entries(properties ?? {}).filter(([name]) => name !== 'operation')) };
}

function providerPrefixNeeded(query: string, prefix: string): boolean {
  const value = query.normalize('NFKC').toLocaleLowerCase('en-US');
  if (value.includes(prefix)) return true;
  if (prefix === azureToolPrefix) {
    return /\b(?:azure|az|subscription|resource|resources|resource group|container app|ressource|ressourcer|ressourcegruppe|abonnement)\b/iu.test(value);
  }
  if (prefix === githubToolPrefix) {
    return /\b(?:github|git-hub|gh|repository|repo|issue|issues|pull request|pull requests|workflow|workflows|code search|kode|arbejdsgang|arbejdsflow)\b/iu.test(value);
  }
  return false;
}

const providerNeeded = (query: string, bridge: RemoteMcpBridge): boolean => providerPrefixNeeded(query, bridge.prefix);

/**
 * The Jarvis tools as an MCP server for the PI agent. It is a thin door, not a second tool system: find_tools ranks the
 * same catalogue chat and voice use, and call_tool runs the chosen tool through the normal `/tools/:name` route, so
 * argument validation, refusals, approvals, receipts and activity events are the ones every other caller gets.
 * Authority is the per-turn reference (see turns.ts): the owner message and session come from the server-side grant,
 * never from anything the model writes.
 */
export function createPiMcpRoutes(options: {
  readonly registry: PiTurnRegistry;
  readonly auth: PiAuth;
  readonly situation?: PiSituationService | undefined;
  readonly bridges?: readonly RemoteMcpBridge[] | undefined;
}): FastifyPluginAsync {
  const { registry, auth } = options;
  const bridges = options.bridges ?? [];

  /** The Deploy smoke may read one GitHub issue and list Azure resources, as the old smoke role did, and nothing else. */
  function smokeMayCall(name: string, args: Record<string, unknown>): boolean {
    if (name.startsWith(githubToolPrefix)) return name === `${githubToolPrefix}issue_read` && args.issue_number === 700 && args.method === 'get';
    return name.startsWith(azureToolPrefix) && /^[a-z_]*list[a-z_]*$/u.test(name.slice(azureToolPrefix.length));
  }

  function automaticSources(name: string, args: Record<string, unknown>): readonly SourceId[] {
    if (name.startsWith('calendar_')) return ['calendar'];
    if (name.startsWith('mail_')) return ['mail'];
    if (name === 'weather') return ['weather'];
    if (name.startsWith('memory_')) return ['memory'];
    if (name.startsWith('health_nutrition_') || name.startsWith('health_food') ||
        name.startsWith('health_meal') || name === 'health_saved_food') return ['nutrition'];
    if (name === 'health_query' || name === 'health_show') {
      const requested = typeof args.source === 'string' ? args.source : '';
      return requested.includes('nutrition') ? ['nutrition'] : ['health'];
    }
    if (name.startsWith('health_')) return ['health'];
    if (name.startsWith('vault_task_')) return ['todos'];
    if (name === 'vault_search' || name === 'vault_read') return ['notes'];
    const factoryTools = [
      'get_work_status', 'list_projects', 'update_project', 'archive_project', 'list_tasks', 'get_task',
      'list_releases', 'get_release', 'get_deployment_status', 'create_task', 'set_task_model',
      'retry_task', 'steer_task',
    ];
    if (factoryTools.includes(name) || name.startsWith(githubToolPrefix)) return ['factory'];
    return [];
  }

  const sourceAllowed = (name: string, args: Record<string, unknown>, disabled: ReadonlySet<string>): boolean => {
    const sources = automaticSources(name, args);
    return sources.length === 0 || sources.some((source) => !disabled.has(source));
  };
  const turnSignalFor = (
    grant: NonNullable<ReturnType<PiTurnRegistry['resolve']>>,
    requestSignal: AbortSignal,
    serverSignal: AbortSignal,
  ) => AbortSignal.any([grant.signal, requestSignal, serverSignal]);
  const disabledFor = async (signal: AbortSignal): Promise<ReadonlySet<string>> => {
    const service = options.situation;
    if (!service) return new Set();
    const current = typeof service.policy === 'function'
      ? await service.policy(signal)
      : await service.read(signal);
    return new Set(current.disabledSources);
  };

  async function callRemote(bridge: RemoteMcpBridge, tool: RegisteredTool, args: Record<string, unknown>, grant: NonNullable<ReturnType<PiTurnRegistry['resolve']>>, signal: AbortSignal): Promise<CallToolResult> {
    const name = tool.name;
    if (grant.smoke === true && !smokeMayCall(name, args)) {
      grant.results.push({ tool: name, outcome: 'refused' });
      return text({ tool: name, outcome: 'refused', result: { refused: 'The smoke may only read one GitHub issue and list Azure resources. Nothing was done.' } });
    }
    const done = await bridge.call(name, args, signal);
    grant.results.push({ tool: name, outcome: done.outcome });
    if (done.outcome === 'ok') {
      const binding = completionEvidence(tool, args, done.result);
      const evidence = completionEvidence(grant.completion, tool, args, done.result, grant.bindings);
      if (evidence) grant.evidence.push(evidence);
      else if (!((grant.completion.contextual || grant.completion.requiresTrustedContext) &&
          binding?.kind === 'retrieved')) grant.unverified.count += 1;
      if (binding?.kind === 'retrieved') grant.bindings.push(binding);
    }
    const body = JSON.stringify(done.result);
    const result = body.length > maxResultCharacters
      ? { truncated: true, preview: body.slice(0, maxResultCharacters), note: 'The result was too long; this is its start.' } : done.result;
    return text({ tool: name, outcome: done.outcome, result }, done.outcome === 'error');
  }

  function buildServer(app: FastifyInstance, signal: AbortSignal): McpServer {
    const server = new McpServer({ name: 'jarvis', version: '1.0.0' });
    server.registerTool('find_tools', {
      title: 'Find Jarvis tools',
      description: 'Jarvis tools are not listed. Look one up by a few English or Danish keywords naming what the thing is (azure resource, github issue, calendar, note, kalender, opgave, noter) to get its description and argument schema, then use call_tool. Exact tool names are ranked first. The compact otherMatches entries can also be called by exact name in this turn. Local matches return without waiting for an unrelated remote catalogue. A provider-specific result that is still starting includes continuation: call find_tools again in this turn with that exact query. Dan’s PC tools (pc_, browser_do) are there for when he asks me to use his PC. Pass the turn reference from the current message.',
      inputSchema: findSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async (input, ctx) => {
      const grant = registry.resolve(input.turn);
      if (!grant) return text({ tool: 'find_tools', outcome: 'refused', result: { refused: unknownTurn } }, true);
      let disabled: ReadonlySet<string> = new Set<string>(grant.activation?.disabledSources ?? []);
      if (grant.brain && options.situation) {
        try { disabled = await disabledFor(
          turnSignalFor(grant, ctx.mcpReq.signal, signal),
        ); }
        catch {
          return text({ tool: 'find_tools', outcome: 'error', result: { error: 'The automatic source policy could not be verified. Nothing was read.' } }, true);
        }
      }
      // Only a provider named by the request is loaded. It gets the bridge's bounded wait while unrelated/local-only searches
      // never wait on it; a catalogue that is still cold returns an explicit same-turn continuation.
      const turnSignal = AbortSignal.any([signal, grant.signal, ctx.mcpReq.signal]);
      const selectedBridges = bridges.filter(bridge => providerNeeded(input.query, bridge));
      const catalogues = await Promise.all(selectedBridges.map(async (bridge) => {
        const tools = await bridge.tools(turnSignal);
        return { bridge, tools, status: bridge.status() };
      }));
      const azure = catalogues.find(({ bridge }) => bridge.prefix === azureToolPrefix);
      if (azure) {
        grant.azure.catalogue = azure.status.state === 'ready' && azure.tools.length === 0 ? 'empty' : azure.status.state;
      } else if (!bridges.some(({ prefix }) => prefix === azureToolPrefix) &&
          providerPrefixNeeded(input.query, azureToolPrefix)) {
        grant.azure.catalogue = 'not_configured';
      }
      const remoteTools = catalogues.flatMap(({ bridge, tools }) => compileRemoteTools(bridge, tools));
      for (const tool of remoteTools) grant.remoteTools.set(tool.name, tool);
      const catalogue: ToolRegistry = remoteTools.length === 0 ? app.jarvisTools : {
        list: () => [...app.jarvisTools.list(), ...remoteTools],
        get: (name) => app.jarvisTools.get(name) ?? remoteTools.find((tool) => tool.name === name),
      };
      const visible = (name: string) => {
        const local = grant.brain
          ? isWakeTool(name)
          : isCurrentAssistantTool(name) || isSituationActivationTool(name);
        return local && (!grant.brain || sourceAllowed(name, {}, disabled));
      };
      const matches = searchJarvisTools(catalogue, input.query, visible);
      // A server that is still loading, or could not be loaded, has no tools in the catalogue. Say which, so the model never
      // reports a server it simply has not heard from yet as "not attached".
      const notes = (noMatch: boolean) => {
        const lines = [
          ...(noMatch ? ['No matching tool. Say so plainly.'] : []),
          ...catalogues.flatMap(({ bridge, status }) => {
            if (status.state === 'starting') return [`${bridge.label} tools are still loading (the server wakes from sleep and can take a minute or two). Search again shortly; ${bridge.label} is attached, just not loaded yet.`];
            if (status.state === 'stale') return [`${bridge.label} is using its last loaded tool list because the refresh failed (${status.reason}). Do not present it as freshly verified; retry if the needed tool is missing.`];
            if (status.state === 'unreachable') return [`${bridge.label} could not be reached (${status.reason}). Say so plainly; do not claim to have looked.`];
            return [];
          }),
        ];
        return lines.length > 0 ? { note: lines.join(' ') } : {};
      };
      const full = matches.slice(0, maxFullResults);
      const other = matches.slice(maxFullResults, maxFullResults + maxOtherResults);
      for (const tool of [...full, ...other]) grant.discovered.add(tool.name);
      const loadingProviders = catalogues.filter(({ status }) => status.state === 'starting');
      return text({
        tool: 'find_tools', outcome: 'ok', result: {
          connections: piConnectionInventory(bridges),
          tools: full.map(tool => ({ name: tool.name, description: tool.description, parameters: shapeSchema(tool) })),
          otherMatches: matches.slice(maxFullResults, maxFullResults + maxOtherResults)
            .map(tool => ({ name: tool.name, description: shortenToolDescription(tool.description) })),
          ...(loadingProviders.length > 0 ? {
            continuation: {
              action: 'find_tools',
              query: input.query,
              providers: loadingProviders.map(({ bridge }) => bridge.label),
              instruction: 'This exact provider catalogue is still loading. Continue this same turn with find_tools using this query instead of answering without the requested capability.',
            },
          } : {}),
          ...notes(matches.length === 0),
        },
      });
    });
    server.registerTool('call_tool', {
      title: 'Run a Jarvis tool',
      description: 'Run a tool that find_tools returned in tools or otherMatches, with its exact name and arguments that follow its schema. The server rechecks visibility, source policy and the turn. Pass the turn reference from the current message. Report what the result says, never more.',
      inputSchema: callSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    }, async (input, ctx) => {
      const grant = registry.resolve(input.turn);
      if (!grant) return text({ tool: input.name, outcome: 'refused', result: { refused: unknownTurn } }, true);
      if (grant.brain) {
        let disabled: ReadonlySet<string> = new Set<string>(grant.activation?.disabledSources ?? []);
        if (options.situation) {
          try { disabled = await disabledFor(
            turnSignalFor(grant, ctx.mcpReq.signal, signal),
          ); }
          catch {
            return text({ tool: input.name, outcome: 'error', result: { error: 'The automatic source policy could not be verified. Nothing was read.' } }, true);
          }
        }
        if (!sourceAllowed(input.name, input.arguments, disabled)) {
          grant.results.push({ tool: input.name, outcome: 'refused' });
          return text({
            tool: input.name, outcome: 'refused',
            result: { refused: 'That source is disabled in Proactive settings. Nothing was read.' },
          });
        }
      }
      const azureRequested = input.name.startsWith(azureToolPrefix);
      if (azureRequested) grant.azure.attempts += 1;
      const bridge = bridges.find((candidate) => input.name.startsWith(candidate.prefix));
      const visibleRemote = grant.brain ? isWakeTool(input.name) : isCurrentAssistantTool(input.name) || isSituationActivationTool(input.name);
      const remoteTool = grant.remoteTools.get(input.name);
      if (bridge && visibleRemote && remoteTool && grant.discovered.has(input.name)) {
        return callRemote(bridge, remoteTool, input.arguments, grant, AbortSignal.any([signal, grant.signal, ctx.mcpReq.signal]));
      }
      const tool = app.jarvisTools.get(input.name);
      const visible = tool && (grant.brain
        ? isWakeTool(tool.name)
        : isCurrentAssistantTool(tool.name) || isSituationActivationTool(tool.name));
      if (!tool || !visible || !grant.discovered.has(tool.name)) {
        if (azureRequested) grant.azure.undiscoveredRefusals += 1;
        return text({ tool: input.name, outcome: 'refused', result: { refused: notFound } });
      }
      const abort = AbortSignal.any([signal, grant.signal, ctx.mcpReq.signal]);
      try {
        const response = await app.inject({
          method: 'POST',
          url: `/tools/${tool.name}`,
          headers: {
            authorization: `Bearer ${auth.dispatch.token}`,
            'content-type': 'application/json',
            // The stored owner message of this turn, from the grant. A brain wake has no owner message: it carries its run id.
            ...(grant.smoke === true ? { 'x-jarvis-smoke': 'true' }
              : grant.brain ? { 'x-jarvis-pi': 'wake', 'x-jarvis-brain': grant.brain.runId }
                : { 'x-jarvis-pi': 'turn', 'x-jarvis-message-id': grant.messageId }),
            ...(grant.activation ? { 'x-jarvis-activation': grant.activation.id } : {}),
          },
          payload: JSON.stringify(input.arguments),
          signal: abort,
        });
        if (response.statusCode !== 200) {
          grant.results.push({ tool: tool.name, outcome: 'error' });
          return text({ tool: tool.name, outcome: 'error', result: { error: 'The tool could not run. Nothing is confirmed as done.' } }, true);
        }
        const serialized = response.body;
        const parsed = JSON.parse(serialized) as { outcome?: unknown; result?: unknown };
        const outcome = parsed.outcome === 'ok' || parsed.outcome === 'refused' ? parsed.outcome : 'error';
        grant.results.push({ tool: tool.name, outcome });
        if (outcome === 'ok') {
          const binding = completionEvidence(tool, input.arguments, parsed.result);
          const evidence = completionEvidence(grant.completion, tool, input.arguments, parsed.result, grant.bindings);
          if (evidence) grant.evidence.push(evidence);
          else if (!((grant.completion.contextual || grant.completion.requiresTrustedContext) &&
              binding?.kind === 'retrieved')) grant.unverified.count += 1;
          if (binding?.kind === 'retrieved') grant.bindings.push(binding);
          if (toolEffect(tool, input.arguments) === 'action') grant.actions.count += 1;
        }
        if (serialized.length > maxResultCharacters) {
          return text({
            tool: tool.name, outcome, truncated: true,
            result: { preview: serialized.slice(0, maxResultCharacters), note: 'The result was too long; this is its start.' },
          });
        }
        return { ...(parsed.outcome === 'error' ? { isError: true } : {}), content: [{ type: 'text', text: serialized }] };
      } catch {
        grant.results.push({ tool: tool.name, outcome: 'error' });
        return text({ tool: tool.name, outcome: 'error', result: { error: 'The tool could not run. Nothing is confirmed as done.' } }, true);
      }
    });
    return server;
  }

  return async (app) => {
    app.route({
      method: ['POST', 'GET', 'DELETE'], url: piMcpPath,
      bodyLimit: 256 * 1024,
      onRequest: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        // Only the managed agent's credential reaches this route; a browser or another service never does.
        if (!request.piMcpAccess) return reply.code(403).send({ error: 'Forbidden' });
        if (request.headers.origin !== undefined || Object.keys(request.query as Record<string, unknown>).length > 0) {
          return reply.code(400).send({ error: 'Invalid PI connector request' });
        }
      },
      handler: async (request, reply) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const disconnect = () => { if (!reply.raw.writableEnded) abort(); };
        request.raw.once('aborted', abort);
        reply.raw.once('close', disconnect);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)]);
        const handler = createMcpHandler(() => buildServer(app, signal));
        try {
          reply.hijack();
          const incoming = Object.assign(request.raw, { method: request.method, url: request.url });
          await toNodeHandler(handler)(incoming, reply.raw, request.body);
        } finally {
          request.raw.off('aborted', abort);
          reply.raw.off('close', disconnect);
        }
      },
    });
  };
}
