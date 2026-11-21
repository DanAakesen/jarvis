import { createHash } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from 'fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { piMcpPath, type PiAuth } from '../auth/pi-credential.js';
import {
  effectOf, isCurrentAssistantTool, isSituationActivationTool, isWakeTool,
  type RegisteredTool, type ToolRegistry,
} from '../core/tool-registry.js';
import { azureToolPrefix, githubToolPrefix, type RemoteMcpBridge } from './remote-mcp.js';
import { providersNamedBy, searchJarvisTools, shortenToolDescription } from './tool-search.js';
import { piTurnPattern, type PiToolAnswer, type PiTurnGrant, type PiTurnRegistry } from './turns.js';
import type { PiSituationService } from './situation.js';
import type { SourceId } from '../proactive/types.js';

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

type Outcome = PiToolAnswer['outcome'];
type Provider = 'local' | typeof githubToolPrefix | typeof azureToolPrefix;

/** How a door call ended: the reply the model gets, and what the ledger (`pi.mcp_tool`) records about it. */
interface Settled {
  readonly reply: CallToolResult;
  readonly outcome: Outcome;
  /** Set by a search that waited on a remote catalogue; otherwise the provider is read from the tool name. */
  readonly provider?: Provider;
  readonly truncated?: boolean;
  readonly duplicate?: boolean;
}

function text(value: unknown, isError = false): CallToolResult {
  const body = JSON.stringify(value);
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: body }] };
}

function say(body: { readonly outcome: Outcome } & Record<string, unknown>, isError = false, extra: Pick<Settled, 'provider' | 'truncated'> = {}): Settled {
  return { reply: text(body, isError), outcome: body.outcome, ...extra };
}

const providerOf = (name: string): Provider =>
  name.startsWith(githubToolPrefix) ? githubToolPrefix : name.startsWith(azureToolPrefix) ? azureToolPrefix : 'local';

const channelOf = (grant: PiTurnGrant) =>
  grant.smoke === true ? 'smoke' : grant.brain ? 'wake' : grant.activation?.type === 'voice' ? 'voice' : 'chat';

/** The first 8 hex characters of the reference's SHA-256: enough to tell the calls of one turn from another's, never the reference. */
const turnHash = (reference: string) => createHash('sha256').update(reference).digest('hex').slice(0, 8);

const answerBytes = (reply: CallToolResult) =>
  reply.content.reduce((total, part) => total + (part.type === 'text' ? Buffer.byteLength(part.text) : 0), 0);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A tool name never contains `{`, so the name and the canonical arguments cannot run into each other. */
const actionKey = (name: string, args: Record<string, unknown>) =>
  createHash('sha256').update(name + canonicalJson(args)).digest('hex');

/**
 * Runs an action once per turn. A repeat with the same tool and the same arguments, from a retry or a replay, gets the first
 * result back with `duplicate: true` instead of running again, also while the first is still running. Only a success is kept:
 * a call that failed or was refused did nothing, so asking again runs it again. This is deduplication, not a gate: nothing
 * is refused.
 */
async function runOnce(
  grant: PiTurnGrant, key: string, run: () => Promise<PiToolAnswer>,
): Promise<{ readonly answer: PiToolAnswer; readonly duplicate: boolean }> {
  for (;;) {
    const earlier = grant.actionResults.get(key);
    if (earlier === undefined) break;
    const first = await earlier;
    if (first) return { answer: { ...first, text: JSON.stringify({ ...JSON.parse(first.text), duplicate: true }) }, duplicate: true };
  }
  const running = run();
  // The entry leaves the map before this promise settles, so a waiter that sees a failure finds the key free and runs the call itself.
  grant.actionResults.set(key, running.then(
    (answer) => {
      if (answer.outcome === 'ok') return answer;
      grant.actionResults.delete(key);
      return undefined;
    },
    () => { grant.actionResults.delete(key); return undefined; },
  ));
  return { answer: await running, duplicate: false };
}

/** Chat never shows the capability-discovery operation selector; every channel uses this catalogue shape. */
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

  async function callRemote(bridge: RemoteMcpBridge, name: string, args: Record<string, unknown>, grant: NonNullable<ReturnType<PiTurnRegistry['resolve']>>, signal: AbortSignal): Promise<Settled> {
    if (grant.smoke === true && !smokeMayCall(name, args)) {
      grant.results.push({ tool: name, outcome: 'refused' });
      return say({ tool: name, outcome: 'refused', result: { refused: 'The smoke may only read one GitHub issue and list Azure resources. Nothing was done.' } });
    }
    const done = await bridge.call(name, args, signal);
    grant.results.push({ tool: name, outcome: done.outcome });
    const body = JSON.stringify(done.result);
    const truncated = body.length > maxResultCharacters;
    const result = truncated
      ? { truncated: true, preview: body.slice(0, maxResultCharacters), note: 'The result was too long; this is its start.' } : done.result;
    return say({ tool: name, outcome: done.outcome, result }, done.outcome === 'error', { truncated });
  }

  function buildServer(app: FastifyInstance, signal: AbortSignal, log: FastifyBaseLogger): McpServer {
    const server = new McpServer({ name: 'jarvis', version: '1.0.0' });
    /**
     * The ledger: one `pi.mcp_tool` line when a door call finishes, however it ends (a refusal, a failure, or an exception on
     * its way out): the tool's name, outcome, time, size of the answer, channel, provider and a hash of the turn reference.
     * Never arguments, results or the reference. It resolves the turn reference once and hands the grant to the call.
     */
    const ledgered = <Input extends { readonly turn: string }>(
      toolOf: (input: Input) => string,
      run: (input: Input, ctx: ServerContext, grant: PiTurnGrant | undefined) => Promise<Settled>,
    ) => async (input: Input, ctx: ServerContext): Promise<CallToolResult> => {
      const started = performance.now();
      const grant = registry.resolve(input.turn);
      let settled: Settled | undefined;
      try {
        settled = await run(input, ctx, grant);
        return settled.reply;
      } finally {
        const tool = toolOf(input);
        try {
          log.info({
            tool,
            outcome: settled?.outcome ?? 'error',
            elapsedMs: Math.round(performance.now() - started),
            ...(settled ? { resultBytes: answerBytes(settled.reply) } : {}),
            truncated: settled?.truncated === true,
            duplicate: settled?.duplicate === true,
            turnHash: turnHash(input.turn),
            ...(grant ? { channel: channelOf(grant) } : {}),
            provider: settled?.provider ?? providerOf(tool),
          }, 'pi.mcp_tool');
        } catch { /* Logging cannot change what a call returns. */ }
      }
    };
    server.registerTool('find_tools', {
      title: 'Find Jarvis tools',
      description: 'Jarvis tools are not listed. Look one up by a few English or Danish keywords naming what the thing is (azure resource, github issue, calendar, kalender, note, vejr) to get its description and argument schema, then use call_tool. Exact tool names are ranked first, and the compact otherMatches entries can be called by exact name too. Local tools return at once; GitHub and Azure tools load only when the keywords name them (github, repo, issue, azure, resource) and may need a second search. Dan’s PC tools (pc_, browser_do) are there for when he asks me to use his PC. Pass the turn reference from the current message.',
      inputSchema: findSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, ledgered<z.infer<typeof findSchema>>(() => 'find_tools', async (input, ctx, grant) => {
      if (!grant) return say({ tool: 'find_tools', outcome: 'refused', result: { refused: unknownTurn } }, true);
      grant.requests.count += 1;
      let disabled: ReadonlySet<string> = new Set<string>(grant.activation?.disabledSources ?? []);
      if (grant.brain && options.situation) {
        try { disabled = await disabledFor(
          turnSignalFor(grant, ctx.mcpReq.signal, signal),
        ); }
        catch {
          return say({ tool: 'find_tools', outcome: 'error', result: { error: 'The automatic source policy could not be verified. Nothing was read.' } }, true);
        }
      }
      // The remote servers' tools (GitHub, Azure) are searched like Jarvis's own, but a provider is loaded only when the query
      // names it, and then for at most the bridge's bounded wait. A search for local tools never waits on a remote catalogue.
      const turnSignal = AbortSignal.any([signal, grant.signal, ctx.mcpReq.signal]);
      const named = providersNamedBy(input.query);
      const selected = bridges.filter((bridge) => (named as ReadonlySet<string>).has(bridge.prefix));
      const catalogues = await Promise.all(selected.map(async (bridge) => {
        const tools = await bridge.tools(turnSignal);
        return { bridge, tools, status: bridge.status() };
      }));
      const azure = catalogues.find(({ bridge }) => bridge.prefix === azureToolPrefix);
      if (azure) {
        grant.azure.catalogue = azure.status.state === 'ready' && azure.tools.length === 0 ? 'empty' : azure.status.state;
      } else if (named.has(azureToolPrefix) && !bridges.some((bridge) => bridge.prefix === azureToolPrefix)) {
        grant.azure.catalogue = 'not_configured';
      }
      const remoteTools = catalogues.flatMap(({ tools }) => tools);
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
        const unloaded = bridges.filter((bridge) => !selected.includes(bridge)).map((bridge) => bridge.label);
        const lines = [
          ...(noMatch ? [unloaded.length > 0
            ? `No matching Jarvis tool. ${unloaded.join(' and ')} tools load only when the search names them: search again with the word ${unloaded.map((label) => label.toLowerCase()).join(' or ')} if the task needs them. Otherwise say so plainly.`
            : 'No matching tool. Say so plainly.'] : []),
          ...catalogues.flatMap(({ bridge, status }) => {
            if (status.state === 'starting') return [`${bridge.label} tools are still loading (the server wakes from sleep and can take a minute or two). Keep going with what you have and search again shortly; ${bridge.label} is attached, just not loaded yet.`];
            if (status.state === 'stale') return [`${bridge.label} is using its last loaded tool list because the refresh failed (${status.reason}). Do not present it as freshly verified.`];
            if (status.state === 'unreachable') return [`${bridge.label} could not be reached (${status.reason}). Say so plainly; do not claim to have looked.`];
            return [];
          }),
        ];
        return lines.length > 0 ? { note: lines.join(' ') } : {};
      };
      const full = matches.slice(0, maxFullResults);
      const other = matches.slice(maxFullResults, maxFullResults + maxOtherResults);
      // A name shown in this result, including an otherMatches entry, can be called without another search.
      for (const tool of [...full, ...other]) grant.discovered.add(tool.name);
      return say({
        tool: 'find_tools', outcome: 'ok', result: {
          tools: full.map(tool => ({ name: tool.name, description: tool.description, parameters: shapeSchema(tool) })),
          otherMatches: other.map(tool => ({ name: tool.name, description: shortenToolDescription(tool.description) })),
          ...notes(matches.length === 0),
        },
      }, false, { provider: providerOf(selected[0]?.prefix ?? '') });
    }));
    server.registerTool('call_tool', {
      title: 'Run a Jarvis tool',
      description: 'Run a tool that find_tools returned (in tools or otherMatches), with its exact name and arguments that follow its schema. Pass the turn reference from the current message. Report what the result says, never more. An action repeated with the same arguments in the same turn is not run again: the first result comes back with duplicate: true.',
      inputSchema: callSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    }, ledgered<z.infer<typeof callSchema>>((input) => input.name, async (input, ctx, grant) => {
      if (!grant) return say({ tool: input.name, outcome: 'refused', result: { refused: unknownTurn } }, true);
      grant.requests.count += 1;
      if (grant.brain) {
        let disabled: ReadonlySet<string> = new Set<string>(grant.activation?.disabledSources ?? []);
        if (options.situation) {
          try { disabled = await disabledFor(
            turnSignalFor(grant, ctx.mcpReq.signal, signal),
          ); }
          catch {
            return say({ tool: input.name, outcome: 'error', result: { error: 'The automatic source policy could not be verified. Nothing was read.' } }, true);
          }
        }
        if (!sourceAllowed(input.name, input.arguments, disabled)) {
          grant.results.push({ tool: input.name, outcome: 'refused' });
          return say({
            tool: input.name, outcome: 'refused',
            result: { refused: 'That source is disabled in Proactive settings. Nothing was read.' },
          });
        }
      }
      const azureRequested = input.name.startsWith(azureToolPrefix);
      if (azureRequested) grant.azure.attempts += 1;
      const bridge = bridges.find((candidate) => input.name.startsWith(candidate.prefix));
      if (bridge && grant.discovered.has(input.name)) {
        return callRemote(bridge, input.name, input.arguments, grant, AbortSignal.any([signal, grant.signal, ctx.mcpReq.signal]));
      }
      const tool = app.jarvisTools.get(input.name);
      const visible = tool && (grant.brain
        ? isWakeTool(tool.name)
        : isCurrentAssistantTool(tool.name) || isSituationActivationTool(tool.name));
      if (!tool || !visible || !grant.discovered.has(tool.name)) {
        if (azureRequested) grant.azure.undiscoveredRefusals += 1;
        return say({ tool: input.name, outcome: 'refused', result: { refused: notFound } });
      }
      const abort = AbortSignal.any([signal, grant.signal, ctx.mcpReq.signal]);
      const failed = (): PiToolAnswer => {
        grant.results.push({ tool: tool.name, outcome: 'error' });
        return {
          outcome: 'error', isError: true, truncated: false,
          text: JSON.stringify({ tool: tool.name, outcome: 'error', result: { error: 'The tool could not run. Nothing is confirmed as done.' } }),
        };
      };
      const run = async (): Promise<PiToolAnswer> => {
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
          if (response.statusCode !== 200) return failed();
          const serialized = response.body;
          const parsed = JSON.parse(serialized) as { outcome?: unknown };
          const outcome = parsed.outcome === 'ok' || parsed.outcome === 'refused' ? parsed.outcome : 'error';
          grant.results.push({ tool: tool.name, outcome });
          if (outcome === 'ok' && tool.execution?.defaultEffect === 'action') grant.actions.count += 1;
          if (serialized.length > maxResultCharacters) {
            return {
              outcome, isError: false, truncated: true,
              text: JSON.stringify({
                tool: tool.name, outcome, truncated: true,
                result: { preview: serialized.slice(0, maxResultCharacters), note: 'The result was too long; this is its start.' },
              }),
            };
          }
          return { outcome, isError: parsed.outcome === 'error', truncated: false, text: serialized };
        } catch {
          return failed();
        }
      };
      // An action is kept for its repeats within the turn; anything that reads, or whose effect is not classified, runs every time.
      const { answer, duplicate } = effectOf(tool, input.arguments) === 'action'
        ? await runOnce(grant, actionKey(tool.name, input.arguments), run)
        : { answer: await run(), duplicate: false };
      return {
        reply: { ...(answer.isError ? { isError: true } : {}), content: [{ type: 'text', text: answer.text }] },
        outcome: answer.outcome, truncated: answer.truncated, duplicate,
      };
    }));
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
        const handler = createMcpHandler(() => buildServer(app, signal, request.log));
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
