import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createPiAuth } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import { coreModule } from '../core/index.js';
import type { JarvisTool } from '../core/tool-registry.js';
import { receipt } from '../core/tool-completion.js';
import { createPiRoutes } from './routes.js';
import { createPiTurnRegistry } from './turns.js';
import { createRemoteMcpBridge, type RemoteMcpBridge } from './remote-mcp.js';
import type { PiSituationService } from './situation.js';
import { completionEvidence, completionPlan } from './completion.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const secret = 'A'.repeat(43);
const ownerToken = 'owner.token.fixture';
const deployToken = 'deploy.token.fixture';
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const probe: JarvisTool = {
  name: 'probe_echo',
  description: 'Echo the text and the owner message the call was attributed to. Keyword: probe.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  execute: async (input, request) => ({
    echoed: (input as { text: string }).text,
    messageId: request.headers['x-jarvis-message-id'],
    asAgent: request.agentPrincipal !== null,
  }),
};

function setup(
  bridges: RemoteMcpBridge[] = [],
  options: { tools?: JarvisTool[]; situation?: PiSituationService; smokeBudgetExhausted?: boolean } = {},
) {
  const registry = createPiTurnRegistry();
  const auth = createPiAuth(config.auth.tenantId, secret);
  const recorded: Array<{ messageId: string; tool: string }> = [];
  const app = buildApp(config, undefined, {
    modules: [coreModule, { id: 'probe', tools: [probe, ...(options.tools ?? [])], registerRoutes: async () => {} },
      { id: 'pi', tools: [], registerRoutes: createPiRoutes({
        gateway: {
          stream: async function* () {},
          status: async () => ({ enabled: options.smokeBudgetExhausted !== true }),
        } as never,
        registry,
        auth,
        monthlyCapDkk: 250,
        bridges,
        ...(options.situation ? { situation: options.situation } : {}),
      }) }],
    auth: async (token) => {
      if (token === deployToken) return { kind: 'jarvis-deploy', objectId: config.auth.deployObjectId, tenantId: config.auth.tenantId };
      if (token !== ownerToken) throw new Error('rejected');
      return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' };
    },
    toolCallStore: { record: async (call) => { recorded.push({ messageId: call.messageId, tool: call.tool }); } },
    piAuth: auth,
  });
  apps.push(app);
  let id = 0;
  async function rpc(token: string | undefined, method: string, params: Record<string, unknown> = {}, url = '/pi/mcp') {
    id += 1;
    const response = await app.inject({
      method: 'POST', url, remoteAddress: '10.0.0.9',
      headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
        ...(token ? { authorization: bearer(token) } : {}),
      },
      payload: { jsonrpc: '2.0', id, method, params },
    });
    const body = response.body.includes('data:')
      ? response.body.split('\n').find((line) => line.startsWith('data:'))!.slice(5) : response.body;
    return { status: response.statusCode, json: body ? JSON.parse(body) as Json : undefined };
  }
  const tool = async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(`jp.${secret}`, 'tools/call', { name, arguments: args });
    const text = result.json?.result?.content?.[0]?.text as string | undefined;
    const body = text?.startsWith('{') ? JSON.parse(text) as Json : undefined;
    return { isError: result.json?.result?.isError === true, body, status: result.status, raw: result.json };
  };
  return { app, registry, rpc, tool, recorded };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const initialize = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } };
const live = () => new AbortController().signal;

describe('PI MCP server', () => {
  it('opens only to the static PI credential, and only on its own route', async () => {
    const { rpc, app } = setup();
    expect((await rpc(undefined, 'initialize', initialize)).status).toBe(401);
    expect((await rpc(`jp.${'B'.repeat(43)}`, 'initialize', initialize)).status).toBe(401);
    expect((await rpc(`jp.${secret}`, 'initialize', initialize)).json?.result?.serverInfo?.name).toBe('jarvis');
    const elsewhere = await app.inject({ method: 'GET', url: '/tools', headers: { authorization: bearer(`jp.${secret}`) } });
    expect(elsewhere.statusCode).toBe(403);
  });

  it('advertises find_tools and call_tool, not the catalogue', async () => {
    const { rpc } = setup();
    const names = ((await rpc(`jp.${secret}`, 'tools/list')).json?.result?.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
    expect(names).toEqual(['call_tool', 'find_tools']);
  });

  it('runs a looked-up tool through the normal route, attributed to the stored owner message and never to the model', async () => {
    const { registry, tool, recorded } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'probe echo' });
    expect(found.body?.result.tools.map((entry: { name: string }) => entry.name)).toContain('probe_echo');
    const called = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'hej' } });
    expect(called.isError).toBe(false);
    expect(called.body).toMatchObject({ tool: 'probe_echo', outcome: 'ok', result: { echoed: 'hej', messageId: '42', asAgent: true } });
    expect(recorded).toEqual([{ messageId: '42', tool: 'probe_echo' }]);
    expect(grant.results).toEqual([{ tool: 'probe_echo', outcome: 'ok' }]);
    // Smuggling an identity through the arguments is refused by the tool's own schema, as for any caller.
    const smuggled = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'x', messageId: '99' } });
    expect(smuggled.body?.outcome).toBe('refused');
    expect(grant.results.at(-1)).toEqual({ tool: 'probe_echo', outcome: 'refused' });
    expect(recorded).toHaveLength(1);
  });

  it('stores same-turn read bindings separately from verified contextual completion', async () => {
    const mailSearch: JarvisTool = {
      name: 'mail_search',
      description: 'Read the requested mail identity for the contextual fixture.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
      execution: { defaultEffect: 'read' },
      execute: async () => ({
        messages: [{ id: 'mail-1', from: 'Alice <alice@example.com>', subject: 'Build' }],
      }),
    };
    const { registry, tool } = setup([], { tools: [mailSearch] });
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Read it.');
    await tool('find_tools', { turn: grant.turn, query: 'mail_search' });
    await tool('call_tool', { turn: grant.turn, name: 'mail_search', arguments: { query: 'from:alice@example.com' } });
    expect(grant.bindings).toHaveLength(1);
    expect(grant.evidence).toHaveLength(0);
    expect(grant.unverified.count).toBe(0);
    await tool('call_tool', { turn: grant.turn, name: 'mail_search', arguments: { query: 'mail-1' } });
    expect(grant.bindings).toHaveLength(2);
    expect(grant.evidence).toHaveLength(1);
  });

  it('returns local matches without starting or waiting for an unrelated remote catalogue', async () => {
    let loads = 0;
    const stalled: RemoteMcpBridge = {
      prefix: 'az_', label: 'Azure', status: () => ({ state: 'starting' }), warm: () => { loads += 1; },
      tools: async () => { loads += 1; await new Promise(() => {}); return []; },
      call: async () => ({ outcome: 'ok', result: {} }),
    };
    const { registry, tool } = setup([stalled]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'probe echo' });
    expect(found.body?.result.tools.map((entry: { name: string }) => entry.name)).toContain('probe_echo');
    expect(found.body?.result.connections).toContainEqual({ name: 'Azure', state: 'starting' });
    expect(loads).toBe(0);
  });

  it('waits within the bounded window for the specifically requested cold provider catalogue', async () => {
    let requests = 0;
    const bridge = createRemoteMcpBridge({
      url: 'https://azure.example/mcp', prefix: 'az_', label: 'Azure', token: async () => 'token',
      fetch: (async (_url: string, init: RequestInit) => {
        requests += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        const body = JSON.parse(String(init.body)) as { id?: number; method: string };
        if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
        const result = body.method === 'tools/list'
          ? { tools: [{
            name: 'group_resource_list',
            description: 'List resources in an Azure resource group.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          }] }
          : { protocolVersion: '2025-06-18', capabilities: {} };
        return Response.json({ jsonrpc: '2.0', id: body.id, result });
      }) as typeof fetch,
    });
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'azure resource group' });
    expect(found.body?.result.tools.map((entry: { name: string }) => entry.name)).toContain('az_group_resource_list');
    expect(grant.discovered.has('az_group_resource_list')).toBe(true);
    expect(requests).toBeGreaterThanOrEqual(2);
  });

  it('executes an eligible exact tool shown in otherMatches without repeating discovery', async () => {
    const extras: JarvisTool[] = Array.from({ length: 5 }, (_, index) => ({
      name: `probe_${index}`,
      description: `Probe catalogue entry ${index}.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({ index }),
    }));
    const { registry, tool, recorded } = setup([], { tools: extras });
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'probe' });
    const exact = (found.body?.result.otherMatches[0] as { name: string }).name;
    expect(grant.discovered.has(exact)).toBe(true);
    const called = await tool('call_tool', { turn: grant.turn, name: exact, arguments: {} });
    expect(called.body).toMatchObject({ tool: exact, outcome: 'ok' });
    expect(recorded).toContainEqual({ messageId: '42', tool: exact });
  });

  it('compiles and executes eligible remote actions through the registry contract', async () => {
    let calls = 0;
    const bridge: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [{
        name: 'gh_issue_update',
        description: 'Update an issue.',
        inputSchema: { type: 'object', properties: { number: { type: 'integer' } }, additionalProperties: false },
        moduleId: 'github',
        execute: async () => ({}),
      }],
      call: async () => {
        calls += 1;
        return { outcome: 'ok', result: { number: 1967, status: 'updated' } };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Update GitHub issue 1967.');
    await tool('find_tools', { turn: grant.turn, query: 'github issue update' });
    const remote = grant.remoteTools.get('gh_issue_update');
    expect(remote?.completion?.operation).toBeTypeOf('function');
    expect(typeof remote?.completion?.operation === 'function'
      ? remote.completion.operation({ number: 1967 })
      : remote?.completion?.operation).toBe('update');
    expect(remote?.completion?.evaluate(
      { number: 1967 },
      { number: 1967, status: 'updated' },
    )).toBe(true);
    expect(completionEvidence(
      remote!,
      { number: 1967 },
      { number: 1967, status: 'updated' },
    )).toBeDefined();
    expect(grant.completion.requirements).toEqual([
      expect.objectContaining({ domain: 'github', operation: 'update' }),
    ]);
    expect(completionEvidence(
      grant.completion,
      remote!,
      { number: 1967 },
      { number: 1967, status: 'updated' },
    )).toBeDefined();
    const result = await tool('call_tool', {
      turn: grant.turn, name: 'gh_issue_update', arguments: { number: 1967 },
    });
    expect(result.body).toMatchObject({ outcome: 'ok' });
    expect(calls).toBe(1);
    expect(grant.unverified.count).toBe(0);
    expect(grant.evidence).toMatchObject([{
      executionId: 'remote:gh_:gh_issue_update',
      tool: 'gh_issue_update',
      kind: 'committed',
      domain: 'github',
      operation: 'update',
    }]);
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_issue_update',
      arguments: { number: 1968, title: 'Issue 1967 updated' },
    });
    expect(calls).toBe(1);
    expect(grant.evidence).toHaveLength(1);
  });

  it('withholds an ambiguous consolidated remote tool without a declared selector', async () => {
    let calls = 0;
    const bridge: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [{
        name: 'gh_issue_write',
        description: 'Create or update an issue.',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' }, number: { type: 'integer' } },
          additionalProperties: false,
        },
        moduleId: 'github',
        execute: async () => ({}),
      }],
      call: async () => {
        calls += 1;
        return { outcome: 'ok', result: { number: 1967 } };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'github issue write' });
    expect(JSON.stringify([
      ...(found.body?.result.tools as unknown[] ?? []),
      ...(found.body?.result.otherMatches as unknown[] ?? []),
    ])).not.toContain('gh_issue_write');
    expect(found.body?.result.note).toContain('no unambiguous operation selector');
    expect(found.body?.result.note).toContain('gh_issue_write');
    expect(grant.remoteTools.has('gh_issue_write')).toBe(false);
    await tool('call_tool', {
      turn: grant.turn, name: 'gh_issue_write', arguments: { number: 1967, title: 'Updated' },
    });
    expect(calls).toBe(0);
  });

  it('uses a declared provider selector instead of inferring from common argument presence', async () => {
    const bridge: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [{
        name: 'gh_issue',
        description: 'Run a declared issue operation.',
        inputSchema: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['create', 'update'] },
            number: { type: 'integer' },
            title: { type: 'string' },
          },
          required: ['operation'],
          additionalProperties: false,
        },
        moduleId: 'github',
        execute: async () => ({}),
      }],
      call: async (_name, args) => ({
        outcome: 'ok',
        result: { number: args.number ?? 1967, status: args.operation === 'create' ? 'created' : 'updated' },
      }),
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Update GitHub issue 1967.');
    await tool('find_tools', { turn: grant.turn, query: 'github issue' });
    const remote = grant.remoteTools.get('gh_issue');
    expect(typeof remote?.completion?.operation === 'function'
      ? remote.completion.operation({ operation: 'update', number: 1967 })
      : remote?.completion?.operation).toBe('update');
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_issue',
      arguments: { operation: 'update', number: 1967, title: 'Updated' },
    });
    expect(grant.evidence.at(-1)).toMatchObject({ operation: 'update', domain: 'github' });
  });

  it('compiles provider-exact push_files identities from nested paths', async () => {
    let calls = 0;
    const bridge: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [
        {
          name: 'gh_push_files',
          description: 'Push files on one branch.',
          inputSchema: {
            type: 'object',
            properties: {
              repository: { type: 'string' },
              branch: { type: 'string' },
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { path: { type: 'string' }, content: { type: 'string' } },
                  required: ['path', 'content'],
                  additionalProperties: false,
                },
              },
              message: { type: 'string' },
            },
            required: ['repository', 'branch', 'files', 'message'],
            additionalProperties: false,
          },
          moduleId: 'github',
          execute: async () => ({}),
        },
        {
          name: 'gh_create_or_update_file',
          description: 'Create or update one file.',
          inputSchema: {
            type: 'object',
            properties: {
              repository: { type: 'string' },
              path: { type: 'string' },
              content: { type: 'string' },
              sha: { type: 'string' },
            },
            required: ['repository', 'path', 'content'],
            additionalProperties: false,
          },
          moduleId: 'github',
          execute: async () => ({}),
        },
      ],
      call: async () => {
        calls += 1;
        return {
          outcome: 'ok',
          result: { repository: 'DanAakesen/jarvis', branch: 'main', sha: 'a'.repeat(40), status: 'written' },
        };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Push src/example.ts to GitHub in DanAakesen/jarvis.');
    await tool('find_tools', { turn: grant.turn, query: 'github push files' });
    expect(grant.remoteTools.has('gh_create_or_update_file')).toBe(true);
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_push_files',
      arguments: {
        repository: 'DanAakesen/jarvis',
        branch: 'main',
        files: [{ path: 'src/example.ts', content: 'const wrongTargetNumber = 42;' }],
        message: 'Push the exact file',
      },
    });
    expect(grant.evidence.at(-1)).toMatchObject({
      executionId: 'remote:gh_:gh_push_files',
      operation: 'update',
      domain: 'github',
    });
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_push_files',
      arguments: {
        repository: 'DanAakesen/jarvis',
        branch: 'main',
        files: [{ path: 'src/wrong.ts', content: 'src/example.ts // wrong path hidden in content' }],
        message: 'Wrong target',
      },
    });
    expect(calls).toBe(1);
    expect(grant.evidence).toHaveLength(1);
  });

  it('binds remote delete receipts to the exact requested target', async () => {
    let calls = 0;
    const bridge: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [{
        name: 'gh_issue_delete',
        description: 'Delete an issue.',
        inputSchema: {
          type: 'object',
          properties: { number: { type: 'integer' } },
          required: ['number'],
          additionalProperties: false,
        },
        moduleId: 'github',
        execute: async () => ({}),
      }],
      call: async (_name, args) => {
        calls += 1;
        return { outcome: 'ok', result: { deleted: true, number: args.number } };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Delete GitHub issue 42.');
    await tool('find_tools', { turn: grant.turn, query: 'github issue delete' });
    await tool('call_tool', {
      turn: grant.turn, name: 'gh_issue_delete', arguments: { number: 42 },
    });
    expect(calls).toBe(1);
    expect(grant.evidence).toMatchObject([{
      executionId: 'remote:gh_:gh_issue_delete',
      operation: 'delete',
      kind: 'committed',
    }]);
    await tool('call_tool', {
      turn: grant.turn, name: 'gh_issue_delete', arguments: { number: 43 },
    });
    expect(calls).toBe(1);
    expect(grant.evidence).toHaveLength(1);
    expect(grant.unverified.count).toBe(0);
  });

  it('refuses an unresolved contextual delete before the local executor is called', async () => {
    let deletes = 0;
    const workspace: JarvisTool = {
      name: 'workspaces_manage',
      description: 'Delete one saved workspace item by exact id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          action: { type: 'string', const: 'delete' },
        },
        required: ['id', 'action'],
        additionalProperties: false,
      },
      execution: {
        defaultEffect: 'action',
        operation: { field: 'action', effects: { delete: 'action' } },
      },
      completion: {
        domain: 'workspace',
        operation: 'delete',
        requestTargetFields: ['id', 'action'],
        resultTargetFields: ['id', 'deleted'],
        evaluate: receipt.workspaceManage,
      },
      execute: async () => {
        deletes += 1;
        return { id: '77', deleted: true };
      },
    };
    const { registry, tool } = setup([], { tools: [workspace] });
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Delete it.');
    await tool('find_tools', { turn: grant.turn, query: 'workspaces manage' });
    const result = await tool('call_tool', {
      turn: grant.turn,
      name: 'workspaces_manage',
      arguments: { id: '77', action: 'delete' },
    });
    expect(result.body).toMatchObject({ outcome: 'refused' });
    expect(deletes).toBe(0);
  });

  it('refuses a generic action contract before dispatch', async () => {
    let executions = 0;
    const action: JarvisTool = {
      name: 'generic_action',
      description: 'Run an action whose operation is not declared.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      execution: { defaultEffect: 'action' },
      completion: {
        domain: 'generic', operation: 'generic', requestTargetFields: ['id'],
        resultTargetFields: ['id'], evaluate: () => true,
      },
      execute: async () => {
        executions += 1;
        return { id: '42' };
      },
    };
    const { registry, tool } = setup([], { tools: [action] });
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Update item 42.');
    await tool('find_tools', { turn: grant.turn, query: 'generic action' });
    const result = await tool('call_tool', {
      turn: grant.turn, name: 'generic_action', arguments: { id: '42' },
    });
    expect(result.body).toMatchObject({ outcome: 'refused' });
    expect(executions).toBe(0);
  });

  it('records only a terminal receipt bound to the classified tool arguments and target', async () => {
    let sends = 0;
    const mail: JarvisTool = {
      name: 'mail_send',
      description: 'Send one email.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
        additionalProperties: false,
      },
      execution: { defaultEffect: 'action' },
      completion: {
        domain: 'mail', operation: 'send', requestTargetFields: ['to', 'subject'],
        resultTargetFields: ['id', 'messageId'], evaluate: receipt.completed,
      },
      execute: async () => {
        sends += 1;
        return { status: 'completed', messageId: 'mail-1' };
      },
    };
    const { registry, tool } = setup([], { tools: [mail] });
    const grant = registry.open({
      ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live(),
    });
    grant.completion = completionPlan('Email Alice about the build.');
    await tool('find_tools', { turn: grant.turn, query: 'mail send' });
    await tool('call_tool', {
      turn: grant.turn, name: 'mail_send',
      arguments: { to: ['alice@example.com'], subject: 'Build', body: 'The build is green.' },
    });
    expect(sends).toBe(1);
    expect(grant.evidence).toHaveLength(1);
    expect(grant.evidence[0]).toMatchObject({
      executionId: 'probe:mail_send', tool: 'mail_send', kind: 'committed', domain: 'mail',
    });
    await tool('call_tool', {
      turn: grant.turn, name: 'mail_send',
      arguments: { to: ['bob@example.com'], subject: 'Another item', body: 'Unrelated.' },
    });
    expect(sends).toBe(1);
    expect(grant.evidence).toHaveLength(1);
  });

  it('says a remote server is still loading, or could not be reached, instead of leaving the model to call it not attached', async () => {
    let status: ReturnType<RemoteMcpBridge['status']> = { state: 'starting' };
    const azure: RemoteMcpBridge = { prefix: 'az_', label: 'Azure', status: () => status, warm: () => {}, tools: async () => [], call: async () => ({ outcome: 'ok', result: {} }) };
    const { registry, tool } = setup([azure]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const loading = await tool('find_tools', { turn: grant.turn, query: 'azure resource group' });
    expect(loading.body?.result.note).toMatch(/Azure tools are still loading.*attached, just not loaded yet/u);
    expect(loading.body?.result.continuation).toMatchObject({
      action: 'find_tools', query: 'azure resource group', providers: ['Azure'],
    });
    expect(grant.azure.catalogue).toBe('starting');
    status = { state: 'unreachable', reason: 'no answer within 200 seconds' };
    const down = await tool('find_tools', { turn: grant.turn, query: 'azure resource group' });
    expect(down.body?.result.note).toMatch(/Azure could not be reached \(no answer within 200 seconds\)/u);
    expect(grant.azure.catalogue).toBe('unreachable');
    status = { state: 'ready' };
    const ready = await tool('find_tools', { turn: grant.turn, query: 'azure resource group' });
    expect(ready.body?.result.note).toBeUndefined();
    expect(grant.azure.catalogue).toBe('empty');
    const undiscovered = await tool('call_tool', { turn: grant.turn, name: 'az_group_resource_list', arguments: {} });
    expect(undiscovered.body?.outcome).toBe('refused');
    expect(grant.azure).toMatchObject({ attempts: 1, undiscoveredRefusals: 1 });
    expect(grant.results).toEqual([]);
  });

  it('hides and refuses automatic mail tools when Mail is disabled', async () => {
    const mail: JarvisTool = {
      name: 'mail_search',
      description: 'Search owner mail. Keyword: inbox.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        additionalProperties: false,
      },
      execution: { defaultEffect: 'read' },
      execute: async () => ({ found: 1 }),
    };
    const situation = {
      async read() {
        return {
          state: null, revision: 0, hash: null, policyRevision: 'a'.repeat(64),
          staleSources: [], missingSources: [], disabledSources: ['mail'], freshSources: [],
          asOf: null, updatedAt: null, lastActivation: null,
        };
      },
    } as PiSituationService;
    const { registry, tool } = setup([], { tools: [mail], situation });
    const grant = registry.open({
      ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '',
      brain: { runId: '00000000-0000-4000-8000-000000000001', sent: [], wrote: [], looked: [] },
      signal: live(),
      activation: {
        id: '00000000-0000-4000-8000-000000000001', type: 'event', source: 'timer', slotKey: null,
        stateRevision: 0, stateHash: null, policyRevision: 'a'.repeat(64), staleSources: 0, disabledSources: ['mail'],
      },
    });
    const found = await tool('find_tools', { turn: grant.turn, query: 'mail inbox' });
    expect(found.body?.result.tools.map((entry: { name: string }) => entry.name)).not.toContain('mail_search');
    grant.discovered.add('mail_search');
    const called = await tool('call_tool', { turn: grant.turn, name: 'mail_search', arguments: {} });
    expect(called.body).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('disabled') } });
  });

  it('uses the selected Health source rather than allowing Nutrition through Health', async () => {
    const health: JarvisTool = {
      name: 'health_show',
      description: 'Show retained health and nutrition records.',
      inputSchema: { type: 'object', properties: { source: { type: 'string' } }, additionalProperties: false },
      execution: { defaultEffect: 'read' },
      execute: async () => ({ shown: true }),
    };
    const situation = {
      async read() {
        return {
          state: null, revision: 0, hash: null, policyRevision: 'a'.repeat(64),
          staleSources: [], missingSources: [], disabledSources: ['nutrition'], freshSources: ['health'],
          asOf: null, updatedAt: null, lastActivation: null,
        };
      },
    } as PiSituationService;
    const { registry, tool } = setup([], { tools: [health], situation });
    const grant = registry.open({
      ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '',
      brain: { runId: '00000000-0000-4000-8000-000000000002', sent: [], wrote: [], looked: [] },
      signal: live(),
      activation: {
        id: '00000000-0000-4000-8000-000000000002', type: 'event', source: 'timer', slotKey: null,
        stateRevision: 0, stateHash: null, policyRevision: 'a'.repeat(64), staleSources: 0,
        disabledSources: ['nutrition'],
      },
    });
    await tool('find_tools', { turn: grant.turn, query: 'health nutrition show' });
    const blocked = await tool('call_tool', {
      turn: grant.turn,
      name: 'health_show',
      arguments: { source: 'daily.nutrition.meals' },
    });
    expect(blocked.body).toMatchObject({ outcome: 'refused', result: { refused: expect.stringContaining('disabled') } });
  });

  it('shows chat the system-health tool without its smoke-only operation selector', async () => {
    const { registry, tool } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const found = await tool('find_tools', { turn: grant.turn, query: 'system health' });
    const health = found.body?.result.tools.find((entry: { name: string }) => entry.name === 'get_system_health');
    expect(health).toBeDefined();
    expect(Object.keys(health.parameters.properties ?? {})).not.toContain('operation');
  });

  it('refuses a tool that was not looked up in this turn, and a forged, closed or foreign turn reference', async () => {
    const { registry, tool, recorded } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    const early = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'x' } });
    expect(early.body).toMatchObject({ outcome: 'refused' });
    const forged = await tool('call_tool', { turn: 'jt-AAAAAAAAAAAAAAAAAAAAAA', name: 'probe_echo', arguments: { text: 'x' } });
    expect(forged).toMatchObject({ isError: true, body: { outcome: 'refused' } });
    const malformed = await tool('call_tool', { turn: '42', name: 'probe_echo', arguments: { text: 'x' } });
    expect(malformed.isError).toBe(true);
    await tool('find_tools', { turn: grant.turn, query: 'probe' });
    registry.close(grant.turn);
    const late = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'x' } });
    expect(late).toMatchObject({ isError: true, body: { outcome: 'refused' } });
    expect(recorded).toEqual([]);
  });

  it('keeps a smoke grant on the read-only smoke role', async () => {
    const { registry, tool, recorded } = setup();
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '', messageId: '', smoke: true, signal: live() });
    await tool('find_tools', { turn: grant.turn, query: 'probe' });
    const called = await tool('call_tool', { turn: grant.turn, name: 'probe_echo', arguments: { text: 'x' } });
    expect(called.body?.outcome).toBe('error');
    expect(recorded).toEqual([]);
  });

  it('does not accept a guessed in-process dispatch token on the tool routes', async () => {
    const { app } = setup();
    const response = await app.inject({ method: 'POST', url: '/tools/probe_echo', payload: { text: 'x' },
      headers: { authorization: bearer('aaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaa.' + 'a'.repeat(43)), 'x-jarvis-message-id': '42' } });
    expect(response.statusCode).toBe(401);
  });

  it('lets only the deployment identity start the live smoke, and only on its own route', async () => {
    const { app } = setup();
    const call = (token: string, method: 'GET' | 'POST', url: string) => app.inject({
      method, url, payload: method === 'POST' ? { part: 'voice' } : undefined, headers: { authorization: bearer(token) },
    });
    expect((await call(ownerToken, 'POST', '/pi/smoke')).statusCode).toBe(403);
    expect((await call(deployToken, 'POST', '/pi/smoke')).statusCode).not.toBe(403);
    const noPart = await app.inject({ method: 'POST', url: '/pi/smoke', payload: {}, headers: { authorization: bearer(deployToken) } });
    expect(noPart.statusCode).toBe(400);
    expect((await call(deployToken, 'GET', '/pi/status')).statusCode).toBe(403);
    expect((await call(deployToken, 'POST', '/pi/warm')).statusCode).toBe(403);
  });

  it('records degraded smoke evidence for each capability refused by the budget preflight', async () => {
    const { app } = setup([], { smokeBudgetExhausted: true });
    const call = (part: 'core' | 'voice') => app.inject({
      method: 'POST',
      url: '/pi/smoke',
      payload: { part },
      headers: { authorization: bearer(deployToken) },
    });

    const core = await call('core');
    expect(core.statusCode).toBe(409);
    expect(core.json()).toMatchObject({ code: 'pi_budget_exhausted' });
    expect((await app.systemStatusReader.read()).entries.find(entry => entry.id === 'foundry.chat'))
      .toMatchObject({
        status: 'degraded',
        details: {
          configured: true,
          engine: 'pi',
          evidence: 'deploy-smoke',
          smokePart: 'core',
          reason: 'budget_exhausted',
        },
      });

    const voice = await call('voice');
    expect(voice.statusCode).toBe(409);
    expect(voice.json()).toMatchObject({ code: 'pi_budget_exhausted' });
    expect((await app.systemStatusReader.read()).entries.find(entry => entry.id === 'foundry.voice'))
      .toMatchObject({
        status: 'degraded',
        details: {
          configured: true,
          engine: 'pi',
          evidence: 'deploy-smoke',
          smokePart: 'voice',
          reason: 'budget_exhausted',
        },
      });
  });
});
