import { createHash } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync } from 'fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { piMcpPath, type PiAuth } from '../auth/pi-credential.js';
import { readOnlyTools } from '../core/tool-effects.js';
import {
  effectOf, isCurrentAssistantTool, isSituationActivationTool, isWakeTool,
  type RegisteredTool, type ToolRegistry,
} from '../core/tool-registry.js';
import { azureToolPrefix, githubToolPrefix, type RemoteMcpBridge } from './remote-mcp.js';
import { compactLargeSchema } from './compact-schema.js';
import { providersNamedBy, searchJarvisTools, shortenToolDescription } from './tool-search.js';
import {
  noteRequest, piTurnPattern, type PiActionRun, type PiReplayCheck, type PiToolAnswer, type PiTurnGrant, type PiTurnRegistry,
} from './turns.js';
import type { PiSituationService } from './situation.js';
import type { SourceId } from '../proactive/types.js';

const maxFullResults = 3;
const maxOtherResults = 5;
const maxResultCharacters = 24_000;
const resultShortenedNote = 'Result shortened; narrow the query by limit, date range or path and call again.';
const firstItemOmittedNote = 'Result shortened; the first array item did not fit, so narrow the query.';
const resultMetadataKeys = new Set([
  'confirmation', 'receipt', 'receipts', 'verifiedRef',
  'next', 'nextCursor', 'nextPageToken', 'nextOffset', 'nextLink', 'hasMore', 'pageInfo', 'page', 'perPage', 'offset', 'limit',
  'coverage', 'incompleteResults', 'partial', 'status', 'truncated', 'warning', 'warnings',
]);
/** The largest body a tool route accepts is 2 MiB (HTML apps); the door adds only a turn reference and a name around the arguments. */
const maxDoorBodyBytes = 2 * 1024 * 1024 + 16 * 1024;
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
  /** The request was a replay of an earlier one (the same call id) and was answered with that one's result, without running. */
  readonly duplicate?: boolean;
  /** An earlier action of the turn with the same tool and arguments had run, or was running; this one ran anyway. */
  readonly sameArgsRepeat?: boolean;
}

/** What a door call knows about its request before it runs. */
interface Door {
  readonly grant: PiTurnGrant | undefined;
  /** SHA-256 of what the request asks for: the tool and its canonical arguments. */
  readonly asked: string;
  /** The call id the harness gave the request in its `_meta`, when it gave one. */
  readonly identity: string | undefined;
  /** Whether a repeat of that call id can be taken for a replay in this turn; absent when the turn reference matched no live turn. */
  readonly replayCheck: PiReplayCheck | undefined;
}

function text(value: unknown, isError = false): CallToolResult {
  const body = JSON.stringify(value);
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: body }] };
}

function say(body: { readonly outcome: Outcome } & Record<string, unknown>, isError = false, extra: Pick<Settled, 'provider' | 'truncated'> = {}): Settled {
  return { reply: text(body, isError), outcome: body.outcome, ...extra };
}

/** JSON carried in `preview` is itself escaped as a string. Its two outer quotes are already budgeted. */
const previewCost = (json: string) => JSON.stringify(json).length - 2;

function jsonPreview(value: unknown, budget: number, omitFirstItem: () => void): string | undefined {
  if (Array.isArray(value)) {
    const entries: string[] = [];
    let remaining = budget - 2;
    for (const entry of value) {
      const item = JSON.stringify(entry) ?? 'null';
      const cost = previewCost(item) + (entries.length > 0 ? 1 : 0);
      if (cost > remaining) break;
      entries.push(item);
      remaining -= cost;
    }
    if (entries.length === 0 && value.length > 0) {
      omitFirstItem();
      return undefined;
    }
    return budget >= 2 ? `[${entries.join(',')}]` : undefined;
  }
  if (value !== null && typeof value === 'object') {
    if (budget < 2) return undefined;
    const fields: string[] = [];
    let remaining = budget - 2;
    for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
      const prefix = `${fields.length > 0 ? ',' : ''}${JSON.stringify(key)}:`;
      const prefixCost = previewCost(prefix);
      if (prefixCost >= remaining) continue;
      const item = jsonPreview(field, remaining - prefixCost, omitFirstItem);
      if (item === undefined) continue;
      fields.push(prefix + item);
      remaining -= prefixCost + previewCost(item);
    }
    return `{${fields.join('')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined || previewCost(serialized) <= budget) return serialized;
  if (typeof value === 'string') {
    const quoteCost = previewCost('""');
    let remaining = budget - quoteCost;
    let end = 0;
    for (const character of value) {
      const cost = previewCost(JSON.stringify(character)) - quoteCost;
      if (cost > remaining) break;
      end += character.length;
      remaining -= cost;
    }
    if (end > 0) return JSON.stringify(value.slice(0, end));
  }
  return undefined;
}

function shortenResult(result: unknown) {
  const serialized = JSON.stringify(result);
  if (serialized === undefined || serialized.length <= maxResultCharacters) return undefined;
  const fields = result !== null && typeof result === 'object' && !Array.isArray(result)
    ? Object.entries(result as Record<string, unknown>) : undefined;
  const metadata = Object.fromEntries((fields ?? []).filter(([key]) => resultMetadataKeys.has(key))
    .map(([key, value]) => [key === 'truncated' ? 'sourceTruncated' : key, value]));
  const payload = fields ? Object.fromEntries(fields.filter(([key]) => !resultMetadataKeys.has(key))) : result;
  const shortened = { ...metadata, truncated: true, totalCharacters: serialized.length, preview: '', note: resultShortenedNote };
  // Keep paging, status and evidence whole, even when those fields alone exceed the budget.
  const budget = maxResultCharacters - JSON.stringify(shortened).length -
    Math.max(0, firstItemOmittedNote.length - resultShortenedNote.length);
  shortened.preview = jsonPreview(payload, budget, () => { shortened.note = firstItemOmittedNote; }) ?? '';
  return shortened;
}

const providerOf = (name: string): Provider =>
  name.startsWith(githubToolPrefix) ? githubToolPrefix : name.startsWith(azureToolPrefix) ? azureToolPrefix : 'local';

const channelOf = (grant: PiTurnGrant) =>
  grant.smoke === true ? 'smoke' : grant.brain ? 'wake' : grant.activation?.type === 'voice' ? 'voice' : 'chat';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The first 8 hex characters of the reference's SHA-256: enough to tell the calls of one turn from another's, never the reference. */
const turnHash = (reference: string) => sha256(reference).slice(0, 8);

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
const askedOf = (tool: string, question: unknown) => sha256(tool + canonicalJson(question));

/** The harness's own name for one tool call, if it sends one in the request's `_meta` (`call_id`, `callId`, `tool_call_id`). */
const callIdKey = /call[_-]?id$/iu;

/**
 * What the harness calls a request, so that the same request delivered again can be told from a new one: a call id in the
 * request's `_meta`, if it sends one. Nothing else qualifies. The JSON-RPC id does not: the door is stateless (there is no MCP
 * session), so a client that opens a connection for each model round numbers its requests 1, 2, 1, 2 ..., and a deliberate repeat
 * of a search and an action is then byte-identical to a retried POST. Without a call id no request of the turn is ever taken for a
 * replay (`replayCheck: no_id`).
 */
export function requestIdentity(meta: unknown): string | undefined {
  if (meta === null || typeof meta !== 'object') return undefined;
  for (const [key, value] of Object.entries(meta)) {
    if (callIdKey.test(key) && typeof value === 'string' && /^[\w.:-]{1,128}$/u.test(value)) return `call:${value}`;
  }
  return undefined;
}

/**
 * The names of the request's `_meta` keys, never their values, for the ledger line: so what the harness really sends, and under
 * which key a call id travels if it does, can be read from live lines. The log allow-list bounds them again.
 */
const metaKeysOf = (meta: unknown): string[] =>
  meta !== null && typeof meta === 'object' ? Object.keys(meta).sort().slice(0, 32) : [];

/**
 * Runs an action call and tells how it relates to the earlier ones of the turn.
 *
 * A replay is the same request delivered again: the same call id asking for the same thing, while call ids can be trusted (see
 * PiReplayCheck). It is answered with the first result and `duplicate: true` and does not run again, also while the first is still
 * running. Everything else runs, even an identical action under another request, because the model may mean it (three sets of the
 * same lift); `repeat` says that an earlier action of the turn with the same tool and arguments had run, or was running, and changes
 * nothing.
 * Only a success, or an error that says the call may have done its work (`outcomeUnknown`), is kept. A refusal declined the action and
 * an error that claims nothing happened reported no success, so a replay of either runs again. An error with no such claim is a
 * choice, not proof that nothing ran: the route reports an error after the tool ran too (an invalid or unserialisable or over-size
 * result), and a tool can fail or be aborted part-way. A call whose answer never arrived is reported as unknown for that reason.
 * This is recognition of a replay, not a gate: nothing is refused.
 */
async function runAction(
  grant: PiTurnGrant, door: Door, run: () => Promise<PiToolAnswer>,
): Promise<{ readonly answer: PiToolAnswer; readonly duplicate: boolean; readonly repeat: boolean }> {
  const { asked, identity } = door;
  const replayable = identity !== undefined && door.replayCheck === 'on';
  for (;;) {
    const replayed = replayable
      ? grant.actionRuns.find((earlier) => earlier.asked === asked && earlier.identity === identity && earlier.state !== 'failed')
      : undefined;
    if (!replayed) break;
    const first = await replayed.answer;
    if (first) return { answer: { ...first, text: JSON.stringify({ ...JSON.parse(first.text), duplicate: true }) }, duplicate: true, repeat: false };
  }
  // A replay of a run that is not failed has returned above, so what is left here is another request's run, or one with no call id.
  const repeat = grant.actionRuns.some((earlier) => earlier.asked === asked && earlier.state !== 'failed');
  const running = run();
  // The state is set before the answer settles, so a replay that waited on a run which failed finds it failed and runs the call itself.
  const record: PiActionRun = {
    asked, identity, state: 'running',
    answer: running.then(
      (answer) => {
        record.state = answer.outcome === 'ok' ? 'ok' : answer.outcomeUnknown === true ? 'unknown' : 'failed';
        return record.state === 'failed' ? undefined : answer;
      },
      () => { record.state = 'failed'; return undefined; },
    ),
  };
  grant.actionRuns.push(record);
  return { answer: await running, duplicate: false, repeat };
}

/** Chat never shows the capability-discovery operation selector; every channel uses this catalogue shape. A very large schema is sent with its repeated parts written once (compact-schema.ts). */
function shapeSchema(tool: RegisteredTool): Readonly<Record<string, unknown>> {
  if (tool.name !== 'get_system_health') return compactLargeSchema(tool.inputSchema);
  const { properties, ...rest } = tool.inputSchema as { properties?: Record<string, unknown> };
  return { ...rest, properties: Object.fromEntries(Object.entries(properties ?? {}).filter(([name]) => name !== 'operation')) };
}

/**
 * The Jarvis tools as an MCP server for the PI agent. It is a thin door, not a second tool system: find_tools ranks the
 * same catalogue chat and voice use. call_tool runs through the normal `/tools/:name` route, so
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
    grant.remote.unverified += 1;
    const done = await bridge.call(name, args, signal);
    if (done.readOnly) grant.remote.unverified -= 1;
    grant.results.push({ tool: name, outcome: done.outcome });
    const shortened = done.outcome === 'ok' && done.readOnly ? shortenResult(done.result) : undefined;
    return say({ tool: name, outcome: done.outcome, result: shortened ?? done.result }, done.outcome === 'error', { truncated: shortened !== undefined });
  }

  function buildServer(app: FastifyInstance, signal: AbortSignal, log: FastifyBaseLogger): McpServer {
    const server = new McpServer({ name: 'jarvis', version: '1.0.0' });
    /**
     * The ledger: one `pi.mcp_tool` line when a door call finishes, however it ends (a refusal, a failure, or an exception on
     * its way out): the tool's name, outcome, time, size of the answer, channel, provider and a hash of the turn reference,
     * whether the request was a replay (`duplicate`), whether an identical action had already run (`sameArgsRepeat`), whether
     * replays could be recognised at all (`replayCheck`) and the names of the request's `_meta` keys (`metaKeys`).
     * Never arguments, results, `_meta` values or the reference.
     * It resolves the turn reference once, and notes the request's call id and what it asks on the turn, for the call to use.
     */
    const ledgered = <Input extends { readonly turn: string }>(
      asks: (input: Input) => { readonly tool: string; readonly question: unknown },
      run: (input: Input, ctx: ServerContext, door: Door) => Promise<Settled>,
    ) => async (input: Input, ctx: ServerContext): Promise<CallToolResult> => {
      const started = performance.now();
      const { tool, question } = asks(input);
      const grant = registry.resolve(input.turn);
      const metaKeys = metaKeysOf(ctx.mcpReq._meta);
      let door: Door | undefined;
      let settled: Settled | undefined;
      try {
        const asked = askedOf(tool, question);
        const identity = requestIdentity(ctx.mcpReq._meta);
        door = { grant, asked, identity, replayCheck: grant ? noteRequest(grant, identity, asked) : undefined };
        settled = await run(input, ctx, door);
        return settled.reply;
      } finally {
        try {
          log.info({
            tool,
            outcome: settled?.outcome ?? 'error',
            elapsedMs: Math.round(performance.now() - started),
            ...(settled ? { resultBytes: answerBytes(settled.reply) } : {}),
            truncated: settled?.truncated === true,
            duplicate: settled?.duplicate === true,
            sameArgsRepeat: settled?.sameArgsRepeat === true,
            ...(door?.replayCheck ? { replayCheck: door.replayCheck } : {}),
            ...(metaKeys.length > 0 ? { metaKeys } : {}),
            turnHash: turnHash(input.turn),
            ...(grant ? { channel: channelOf(grant) } : {}),
            provider: settled?.provider ?? providerOf(tool),
          }, 'pi.mcp_tool');
        } catch { /* Logging cannot change what a call returns. */ }
      }
    };
    server.registerTool('find_tools', {
      title: 'Find Jarvis tools',
      description: 'Look up Jarvis tools using English or Danish keywords (azure resource, github issue, calendar, kalender, note, vejr), then use call_tool. Use this for weather, calendar_list_events and owner_reminders too. Exact names rank first; compact otherMatches can also be called by name. GitHub and Azure tools load only when named (github, repo, issue, azure, resource) and may need a second search. Use Dan’s PC tools (pc_, browser_do) when he asks you to use his PC. Pass the turn reference from the current message.',
      inputSchema: findSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, ledgered<z.infer<typeof findSchema>>((input) => ({ tool: 'find_tools', question: { query: input.query } }), async (input, ctx, { grant }) => {
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
      description: 'Run a tool from find_tools (in tools or otherMatches) using its exact name and schema. Pass the turn reference from the current message. Report what the result says, never more.',
      inputSchema: callSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    }, ledgered<z.infer<typeof callSchema>>((input) => ({ tool: input.name, question: input.arguments }), async (input, ctx, door) => {
      const { grant } = door;
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
      // What this call does: the operation it names, not the tool's default (a gym list reads), and a writer that declares nothing
      // is still a writer (see tool-effects.ts).
      const effect = effectOf(tool, input.arguments);
      /** `mayHaveRun`: the route gave up after it could have started the tool, so an action is not reported as having done nothing. */
      const failed = (mayHaveRun: boolean): PiToolAnswer => {
        grant.results.push({ tool: tool.name, outcome: 'error' });
        const unknown = mayHaveRun && effect === 'action';
        return {
          outcome: 'error', isError: true, truncated: false, ...(unknown ? { outcomeUnknown: true } : {}),
          text: JSON.stringify({
            tool: tool.name, outcome: 'error',
            result: unknown
              ? { error: 'The tool did not answer, so it may or may not have gone through. Check before trying again.', outcomeUnknown: true }
              : { error: 'The tool could not run. Nothing is confirmed as done.' },
          }),
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
                  : { 'x-jarvis-pi': 'turn', 'x-jarvis-message-id': grant.messageId, ...(grant.activation?.type === 'voice' ? { 'x-jarvis-pi-channel': 'voice' } : {}) }),
              ...(grant.activation ? { 'x-jarvis-activation': grant.activation.id } : {}),
            },
            payload: JSON.stringify(input.arguments),
            signal: abort,
          });
          // A 4xx or the 503 for a missing store answers before the tool starts; any other status can come after it ran.
          if (response.statusCode !== 200) return failed(response.statusCode >= 500 && response.statusCode !== 503);
          const serialized = response.body;
          const parsed = JSON.parse(serialized) as { outcome?: unknown; result?: unknown; confirmation: string };
          const outcome = parsed.outcome === 'ok' || parsed.outcome === 'refused' ? parsed.outcome : 'error';
          const outcomeUnknown = outcome === 'error' && typeof parsed.result === 'object' && parsed.result !== null &&
            (parsed.result as { outcomeUnknown?: unknown }).outcomeUnknown === true;
          grant.results.push({ tool: tool.name, outcome });
          if (outcome === 'ok' && effect === 'action') grant.actions.count += 1;
          const readOnly = effect === 'read' || (tool.execution === undefined && readOnlyTools.has(tool.name));
          if (outcome === 'ok' && !grant.brain && !grant.smoke && typeof parsed.confirmation === 'string') {
            grant.receipts.push({ confirmation: parsed.confirmation, action: effect === 'action' });
          }
          // The capability catalogue has no page or range selector, so keep every tool and feature visible.
          const shortened = outcome === 'ok' && readOnly && tool.name !== 'list_capabilities' ? shortenResult(parsed.result) : undefined;
          return {
            outcome, isError: parsed.outcome === 'error', truncated: shortened !== undefined,
            text: shortened ? JSON.stringify({ ...parsed, result: shortened, confirmation: `${parsed.confirmation} Result shortened.` }) : serialized,
            ...(outcomeUnknown ? { outcomeUnknown } : {}),
          };
        } catch {
          return failed(true);
        }
      };
      // An action is run through the replay check; anything that reads, or whose effect is not classified, simply runs.
      const { answer, duplicate, repeat } = effect === 'action'
        ? await runAction(grant, door, run)
        : { answer: await run(), duplicate: false, repeat: false };
      return {
        reply: { ...(answer.isError ? { isError: true } : {}), content: [{ type: 'text', text: answer.text }] },
        outcome: answer.outcome, truncated: answer.truncated, duplicate, sameArgsRepeat: repeat,
      };
    }));
    return server;
  }

  return async (app) => {
    app.route({
      method: ['POST', 'GET', 'DELETE'], url: piMcpPath,
      bodyLimit: maxDoorBodyBytes,
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
