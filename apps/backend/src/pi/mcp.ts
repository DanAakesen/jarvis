import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { piMcpPath, type PiAuth } from '../auth/pi-credential.js';
import {
  isCurrentAssistantTool, isSituationActivationTool, isWakeTool,
  type RegisteredTool,
} from '../core/tool-registry.js';
import { azureToolPrefix, githubToolPrefix, requestedRemoteMcpPrefixes, type RemoteMcpBridge } from './remote-mcp.js';
import { searchVoiceTools, shortenVoiceDescription } from '../voice/voice-tools.js';
import { piTurnPattern, type PiTurnRegistry } from './turns.js';
import { finishPiTurn, piCompletionSchema, recordPiToolEvidence } from './completion.js';
import type { PiSituationService } from './situation.js';
import type { SourceId } from '../proactive/types.js';

const maxFullResults = 3;
const maxOtherResults = 5;
const maxResultCharacters = 200_000;
const notFound = 'Unknown tool, or not looked up yet. Call find_tools first, then call_tool. Nothing was done.';
const unknownTurn = 'This turn is not active, so nothing was done. Use the exact turn reference from the current message.';
type Grant = NonNullable<ReturnType<PiTurnRegistry['resolve']>>;

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

/** Chat never shows the capability-discovery operation selector; the voice and chat catalogues stay aligned. */
function shapeSchema(tool: RegisteredTool): unknown {
  if (tool.name !== 'get_system_health') return tool.inputSchema;
  const { properties, ...rest } = tool.inputSchema as { properties?: Record<string, unknown> };
  return { ...rest, properties: Object.fromEntries(Object.entries(properties ?? {}).filter(([name]) => name !== 'operation')) };
}

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
  const discoveredRemote = new WeakMap<Grant, Map<string, boolean | undefined>>();
  const inFlight = new WeakMap<Grant, Set<string>>();

  function beginActual(grant: Grant, name: string, args: Record<string, unknown>): CallToolResult | (() => void) {
    if (grant.completion) return text({ tool: name, outcome: 'refused', result: { refused: 'This turn has already finished. Nothing was done.' } });
    const key = JSON.stringify([name, args], (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
    const active = inFlight.get(grant) ?? new Set<string>();
    if (active.has(key)) return text({ tool: name, outcome: 'refused', result: { refused: 'An identical call is already in progress. Nothing was repeated.' } });
    inFlight.set(grant, active);
    active.add(key);
    grant.inFlightToolCalls += 1;
    return () => {
      active.delete(key);
      grant.inFlightToolCalls -= 1;
    };
  }

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
    grant: Grant,
    requestSignal: AbortSignal,
    serverSignal: AbortSignal,
  ) => AbortSignal.any([grant.signal, requestSignal, serverSignal]);

  async function callRemote(bridge: RemoteMcpBridge, name: string, args: Record<string, unknown>, grant: Grant, signal: AbortSignal): Promise<CallToolResult> {
    if (grant.smoke === true && !smokeMayCall(name, args)) {
      grant.results.push({ tool: name, outcome: 'refused' });
      return text({ tool: name, outcome: 'refused', result: { refused: 'The smoke may only read one GitHub issue and list Azure resources. Nothing was done.' } });
    }
    const release = beginActual(grant, name, args);
    if (typeof release !== 'function') return release;
    try {
      const done = await bridge.call(name, args, signal);
      grant.results.push({ tool: name, outcome: done.outcome });
      if (done.outcome === 'ok') {
        const readOnly = discoveredRemote.get(grant)?.get(name);
        recordPiToolEvidence(grant, name, args, done.result, readOnly === undefined ? undefined : { readOnly });
      }
      const body = JSON.stringify(done.result);
      const result = body.length > maxResultCharacters
        ? { truncated: true, preview: body.slice(0, maxResultCharacters), note: 'The result was too long; this is its start.' } : done.result;
      return text({ tool: name, outcome: done.outcome, result }, done.outcome === 'error');
    } finally {
      release();
    }
  }

  function buildServer(app: FastifyInstance, signal: AbortSignal): McpServer {
    const server = new McpServer({ name: 'jarvis', version: '1.0.0' });
    server.registerTool('find_tools', {
      title: 'Find Jarvis tools',
      description: 'Look up tools by English or Danish keywords, or by exact tool name to see its schema. Include GitHub or Azure in the query when you need that provider (e.g. github issue, Azure ressourcegruppe). For local tools use keywords like calendar, note, task or web research. Dan’s PC tools (pc_, browser_do) are there for when he asks me to use his PC. Pass the turn reference from the current message.',
      inputSchema: findSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async (input, ctx) => {
      const grant = registry.resolve(input.turn);
      if (!grant) return text({ tool: 'find_tools', outcome: 'refused', result: { refused: unknownTurn } }, true);
      let disabled = new Set<string>(grant.activation?.disabledSources ?? []);
      if (grant.brain && options.situation) {
        try { disabled = new Set((await options.situation.read(turnSignalFor(grant, ctx.mcpReq.signal, signal))).disabledSources); }
        catch {
          return text({ tool: 'find_tools', outcome: 'error', result: { error: 'The automatic source policy could not be verified. Nothing was read.' } }, true);
        }
      }
      const turnSignal = turnSignalFor(grant, ctx.mcpReq.signal, signal);
      turnSignal.throwIfAborted();
      const visible = (name: string) => {
        const allowed = grant.brain
          ? isWakeTool(name)
          : isCurrentAssistantTool(name) || isSituationActivationTool(name);
        return allowed && (!grant.brain || sourceAllowed(name, {}, disabled));
      };
      const requested = requestedRemoteMcpPrefixes(input.query).filter((prefix) => visible(`${prefix}catalogue`));
      const catalogues = await Promise.all(requested.map(async (prefix) => {
        const bridge = bridges.find((candidate) => candidate.prefix === prefix);
        if (!bridge) return { prefix, label: prefix === azureToolPrefix ? 'Azure' : 'GitHub', tools: [], status: { state: 'not_configured' } as const };
        const tools = await bridge.tools(turnSignal);
        const status = bridge.status();
        return { prefix, label: bridge.label, tools, status: status.state === 'ready' && tools.length === 0 ? { state: 'empty' } as const : status };
      }));
      const azure = catalogues.find(({ prefix }) => prefix === azureToolPrefix);
      if (azure) grant.azure.catalogue = azure.status.state;
      const remoteTools = catalogues.flatMap(({ tools }) => tools);
      const localMatches = searchVoiceTools(app.jarvisTools, input.query, visible);
      const remoteMatches = searchVoiceTools({ list: () => remoteTools }, input.query, visible);
      const exactLocal = localMatches[0]?.name === input.query.trim().toLowerCase();
      const matches = exactLocal ? [...localMatches, ...remoteMatches] : [...remoteMatches, ...localMatches];
      // A server that is still loading, or could not be loaded, has no tools in the catalogue. Say which, so the model never
      // reports a server it simply has not heard from yet as "not attached".
      const notes = (noMatch: boolean) => {
        const lines = [
          ...(noMatch ? ['No matching tool. Say so plainly.'] : []),
          ...catalogues.flatMap(({ label, status }) => {
            if (status.state === 'starting') return [`${label} tools are still loading (the server wakes from sleep and can take a minute or two). Search again shortly; ${label} is attached, just not loaded yet.`];
            if (status.state === 'unreachable') return [`${label} could not be reached (${status.reason}). Say so plainly; do not claim to have looked.`];
            if (status.state === 'not_configured') return [`${label} is not configured for this connector.`];
            return [];
          }),
        ];
        return lines.length > 0 ? { note: lines.join(' ') } : {};
      };
      const full = matches.slice(0, maxFullResults);
      const others = matches.slice(maxFullResults, maxFullResults + maxOtherResults);
      const readOnlyByName = discoveredRemote.get(grant) ?? new Map<string, boolean | undefined>();
      for (const tool of [...full, ...others]) {
        grant.discovered.add(tool.name);
        const remote = remoteTools.find(({ name }) => name === tool.name);
        if (remote) readOnlyByName.set(remote.name, remote.readOnly);
      }
      discoveredRemote.set(grant, readOnlyByName);
      return text({
        tool: 'find_tools', outcome: 'ok', result: {
          tools: full.map(tool => ({ name: tool.name, description: tool.description, parameters: shapeSchema(tool) })),
          otherMatches: others
            .map(tool => ({ name: tool.name, description: shortenVoiceDescription(tool.description) })),
          ...notes(matches.length === 0),
        },
      });
    });
    server.registerTool('call_tool', {
      title: 'Run a Jarvis tool',
      description: 'Run a tool that find_tools returned in tools or otherMatches, using its exact name and schema-valid arguments. Pass the turn reference from the current message. Report what the result says, never more.',
      inputSchema: callSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    }, async (input, ctx) => {
      const grant = registry.resolve(input.turn);
      if (!grant) return text({ tool: input.name, outcome: 'refused', result: { refused: unknownTurn } }, true);
      if (grant.brain) {
        let disabled = new Set<string>(grant.activation?.disabledSources ?? []);
        if (options.situation) {
          try { disabled = new Set((await options.situation.read(turnSignalFor(grant, ctx.mcpReq.signal, signal))).disabledSources); }
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
      if (bridge && grant.discovered.has(input.name) && discoveredRemote.get(grant)?.has(input.name)) {
        return callRemote(bridge, input.name, input.arguments, grant, turnSignalFor(grant, ctx.mcpReq.signal, signal));
      }
      const tool = app.jarvisTools.get(input.name);
      const visible = tool && (grant.brain
        ? isWakeTool(tool.name)
        : isCurrentAssistantTool(tool.name) || isSituationActivationTool(tool.name));
      if (!tool || !visible || !grant.discovered.has(tool.name)) {
        if (azureRequested) grant.azure.undiscoveredRefusals += 1;
        return text({ tool: input.name, outcome: 'refused', result: { refused: notFound } });
      }
      const abort = turnSignalFor(grant, ctx.mcpReq.signal, signal);
      const release = beginActual(grant, input.name, input.arguments);
      if (typeof release !== 'function') return release;
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
          if (tool.execution?.defaultEffect === 'action') grant.actions.count += 1;
          recordPiToolEvidence(grant, tool.name, input.arguments, parsed.result, { execution: tool.execution, durableJobs: app.backgroundJobs.durable });
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
      } finally {
        release();
      }
    });
    server.registerTool('finish_turn', {
      title: 'Finish the current owner turn',
      description: 'Record completion only once the owner request has a verified outcome. Do not start more tool calls after finishing.',
      inputSchema: piCompletionSchema,
    }, async (input) => {
      const grant = registry.resolve(input.turn);
      if (!grant || grant.brain || grant.smoke) return text({ outcome: 'refused', error: unknownTurn }, true);
      const error = finishPiTurn(grant, input);
      return error ? text({ outcome: 'refused', error }, true) : text({ outcome: 'ok' });
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
