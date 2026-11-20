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
import {
  azureActionNames, azureActionSpecs, githubActionNames, githubActionSpecs,
} from './remote-action-contracts.js';

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
const deployedGithubWriteNames = [
  'actions_run_trigger',
  'add_automation_to_group',
  'add_comment_to_pending_review',
  'add_issue_comment',
  'add_issue_comment_reaction',
  'add_issue_reaction',
  'add_pull_request_review_comment',
  'add_pull_request_review_comment_reaction',
  'add_reply_to_pull_request_comment',
  'add_sub_issue',
  'assign_copilot_to_issue',
  'assign_copilot_to_issue_with_intent',
  'create_automation',
  'create_automation_group',
  'create_branch',
  'create_gist',
  'create_issue',
  'create_or_update_file',
  'create_pull_request',
  'create_pull_request_review',
  'create_repository',
  'create_repository_ruleset',
  'custom_properties_write',
  'delete_automation',
  'delete_file',
  'delete_pending_pull_request_review',
  'delete_repository',
  'discussion_comment_write',
  'dismiss_notification',
  'fork_repository',
  'hide_issue_comment',
  'hide_pull_request_review',
  'hide_pull_request_review_comment',
  'issue_artifact_write',
  'issue_dependency_write',
  'issue_write',
  'label_write',
  'manage_notification_subscription',
  'manage_repository_notification_subscription',
  'mark_all_notifications_read',
  'merge_pull_request',
  'projects_write',
  'pull_request_artifact_write',
  'pull_request_review_write',
  'push_files',
  'remove_issue_comment_reaction',
  'remove_issue_reaction',
  'remove_pull_request_review_comment_reaction',
  'remove_automation_from_group',
  'remove_sub_issue',
  'reprioritize_sub_issue',
  'request_copilot_review',
  'request_pull_request_reviewers',
  'resolve_review_thread',
  'run_automation',
  'set_issue_fields',
  'star_repository',
  'sub_issue_write',
  'submit_pending_pull_request_review',
  'unhide_issue_comment',
  'unhide_pull_request_review',
  'unhide_pull_request_review_comment',
  'unresolve_review_thread',
  'unstar_repository',
  'update_automation',
  'update_code_scanning_alert',
  'update_dependabot_alert',
  'update_gist',
  'update_issue_assignees',
  'update_issue_body',
  'update_issue_comment',
  'update_issue_labels',
  'update_issue_milestone',
  'update_issue_state',
  'update_issue_title',
  'update_issue_type',
  'update_pull_request',
  'update_pull_request_body',
  'update_pull_request_branch',
  'update_pull_request_draft_state',
  'update_pull_request_state',
  'update_pull_request_title',
  'update_secret_scanning_alert',
] as const;

describe('PI MCP server', () => {
  it('tracks every deployed GitHub and Azure write contract exactly', () => {
    expect([...githubActionNames].sort()).toEqual([...deployedGithubWriteNames].sort());
    expect(azureActionNames).toEqual(['monitor_webtests_createorupdate']);
  });

  it('compiles every exact deployed write schema without name inference', async () => {
    const schemaTools = Object.entries(githubActionSpecs).map(([name, spec]) => {
      const properties: Record<string, unknown> =
        Object.fromEntries(spec.identityFields.map(field => [field, { type: 'string' }]));
      if (spec.selector) {
        properties[spec.selector.field] = name === 'sub_issue_write'
          ? { type: 'string' }
          : { type: 'string', enum: Object.keys(spec.selector.choices) };
      }
      if (spec.identityFiles) properties.files = {
        type: 'array',
        items: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
      };
      return {
        name: `gh_${name}`,
        description: `GitHub ${name}`,
        inputSchema: { type: 'object', properties, additionalProperties: false },
        moduleId: 'github',
        execute: async () => ({}),
      };
    });
    const azureTools = Object.entries(azureActionSpecs).map(([name, spec]) => ({
      name: `az_${name}`,
      description: `Azure ${name}`,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(spec.identityFields.map(field => [field, { type: 'string' }])),
        additionalProperties: false,
      },
      moduleId: 'azure',
      execute: async () => ({}),
    }));
    const github: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => schemaTools, call: async () => ({ outcome: 'ok', result: {} }),
    };
    const azure: RemoteMcpBridge = {
      prefix: 'az_', label: 'Azure', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => azureTools, call: async () => ({ outcome: 'ok', result: {} }),
    };
    const { registry, tool } = setup([github, azure]);
    const grant = registry.open({
      ownerObjectId: config.auth.ownerObjectId,
      sessionId: '7',
      messageId: '42',
      signal: live(),
    });
    const githubFound = await tool('find_tools', {
      turn: grant.turn, query: 'github issue automation repository action catalogue',
    });
    const azureFound = await tool('find_tools', {
      turn: grant.turn, query: 'azure monitor webtest update',
    });
    expect(githubFound.body?.result.providerContractErrors).toBeUndefined();
    expect(azureFound.body?.result.providerContractErrors).toBeUndefined();
    for (const name of deployedGithubWriteNames) {
      const remote = grant.remoteTools.get(`gh_${name}`);
      expect(remote).toBeDefined();
      const spec = githubActionSpecs[name];
      const args = {
        ...(spec?.selector ? { [spec.selector.field]: Object.keys(spec.selector.choices)[0] } : {}),
        ...(name === 'assign_copilot_to_issue_with_intent' ? { is_suggestion: false } : {}),
      };
      expect(typeof remote?.completion?.operation === 'function'
        ? remote.completion.operation(args)
        : remote?.completion?.operation).not.toBe('generic');
    }
    expect(grant.remoteTools.has('az_monitor_webtests_createorupdate')).toBe(true);
    for (const [name, args, operation] of [
      ['gh_actions_run_trigger', { method: 'cancel_workflow_run' }, 'delete'],
      ['gh_issue_write', { method: 'update' }, 'update'],
      ['gh_label_write', { method: 'delete' }, 'delete'],
      ['gh_projects_write', { method: 'create_project' }, 'create'],
      ['gh_pull_request_review_write', { method: 'create' }, 'create'],
      ['gh_pull_request_review_write', { method: 'submit_pending' }, 'send'],
      ['gh_sub_issue_write', { method: 'add' }, 'update'],
      ['az_monitor_webtests_createorupdate', {}, 'update'],
    ] as const) {
      const remote = grant.remoteTools.get(name);
      expect(typeof remote?.completion?.operation === 'function'
        ? remote.completion.operation(args)
        : remote?.completion?.operation).toBe(operation);
    }
  });

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
        name: 'gh_issue_write',
        description: 'Update an issue.',
        inputSchema: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['create', 'update'] },
            owner: { type: 'string' }, repo: { type: 'string' },
            issue_number: { type: 'integer' }, title: { type: 'string' },
          },
          required: ['method', 'owner', 'repo'],
          additionalProperties: false,
        },
        moduleId: 'github',
        execute: async () => ({}),
      }],
      call: async () => {
        calls += 1;
        return {
          outcome: 'ok',
          result: {
            method: 'update',
            issue: { id: 'issue-1967', url: 'https://github.com/DanAakesen/jarvis/issues/1967' },
          },
        };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Update GitHub issue 1967 in DanAakesen/jarvis.');
    await tool('find_tools', { turn: grant.turn, query: 'github issue update' });
    const remote = grant.remoteTools.get('gh_issue_write');
    const args = {
      method: 'update', owner: 'DanAakesen', repo: 'jarvis', issue_number: 1967,
    };
    expect(remote?.completion?.operation).toBeTypeOf('function');
    expect(typeof remote?.completion?.operation === 'function'
      ? remote.completion.operation(args)
      : remote?.completion?.operation).toBe('update');
    expect(remote?.completion?.evaluate(
      args,
      {
        method: 'update',
        issue: { id: 'issue-1967', url: 'https://github.com/DanAakesen/jarvis/issues/1967' },
      },
    )).toBe(true);
    expect(completionEvidence(
      remote!,
      args,
      {
        method: 'update',
        issue: { id: 'issue-1967', url: 'https://github.com/DanAakesen/jarvis/issues/1967' },
      },
    )).toBeDefined();
    expect(grant.completion.requirements).toEqual([
      expect.objectContaining({ domain: 'github', operation: 'update' }),
    ]);
    expect(completionEvidence(
      grant.completion,
      remote!,
      args,
      {
        method: 'update',
        issue: { id: 'issue-1967', url: 'https://github.com/DanAakesen/jarvis/issues/1967' },
      },
    )).toBeDefined();
    const result = await tool('call_tool', {
      turn: grant.turn, name: 'gh_issue_write', arguments: args,
    });
    expect(result.body).toMatchObject({ outcome: 'ok' });
    expect(calls).toBe(1);
    expect(grant.unverified.count).toBe(0);
    expect(grant.evidence).toMatchObject([{
      executionId: 'remote:gh_:gh_issue_write',
      tool: 'gh_issue_write',
      kind: 'committed',
      domain: 'github',
      operation: 'update',
    }]);
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_issue_write',
      arguments: {
        ...args,
        issue_number: 1968,
        title: 'Issue 1967 updated',
      },
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
          properties: {
            owner: { type: 'string' }, repo: { type: 'string' },
            issue_number: { type: 'integer' }, title: { type: 'string' },
          },
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
    expect(found.body?.result.providerContractErrors).toContainEqual({
      tool: 'gh_issue_write',
      error: expect.any(String),
    });
    expect(grant.remoteTools.has('gh_issue_write')).toBe(false);
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_issue_write',
      arguments: { owner: 'DanAakesen', repo: 'jarvis', issue_number: 1967, title: 'Updated' },
    });
    expect(calls).toBe(0);
  });

  it('withholds a declared selector when no provider-exact action contract exists', async () => {
    let calls = 0;
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
      call: async () => {
        calls += 1;
        return { outcome: 'ok', result: { number: 1967, status: 'updated' } };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Update GitHub issue 1967.');
    const found = await tool('find_tools', { turn: grant.turn, query: 'github issue' });
    expect(found.body?.result.providerContractErrors).toContainEqual({
      tool: 'gh_issue',
      error: expect.any(String),
    });
    expect(grant.remoteTools.has('gh_issue')).toBe(false);
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_issue',
      arguments: { operation: 'update', number: 1967, title: 'Updated' },
    });
    expect(calls).toBe(0);
    expect(grant.evidence).toHaveLength(0);
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
              owner: { type: 'string' }, repo: { type: 'string' },
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
            required: ['owner', 'repo', 'branch', 'files', 'message'],
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
              owner: { type: 'string' }, repo: { type: 'string' },
              branch: { type: 'string' },
              path: { type: 'string' },
              content: { type: 'string' },
              sha: { type: 'string' },
            },
            required: ['owner', 'repo', 'branch', 'path', 'content'],
            additionalProperties: false,
          },
          moduleId: 'github',
          execute: async () => ({}),
        },
      ],
      call: async (name) => {
        calls += 1;
        return {
          outcome: 'ok',
          result: name === 'gh_push_files'
            ? { ref: 'refs/heads/main', object: { type: 'commit', sha: 'b'.repeat(40) } }
            : { commit: { sha: 'b'.repeat(40) }, content: { path: 'src/example.ts' } },
        };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Push src/example.ts to GitHub in DanAakesen/jarvis on main.');
    await tool('find_tools', { turn: grant.turn, query: 'github push files' });
    expect(grant.remoteTools.has('gh_create_or_update_file')).toBe(true);
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_push_files',
      arguments: {
        owner: 'DanAakesen', repo: 'jarvis',
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
        owner: 'DanAakesen', repo: 'jarvis',
        branch: 'main',
        files: [{ path: 'src/wrong.ts', content: 'src/example.ts // wrong path hidden in content' }],
        message: 'Wrong target',
      },
    });
    expect(calls).toBe(1);
    expect(grant.evidence).toHaveLength(1);

    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_create_or_update_file',
      arguments: {
        owner: 'DanAakesen', repo: 'jarvis', branch: 'main',
        path: 'src/example.ts', content: 'const value = 1;',
        sha: 'a'.repeat(40),
      },
    });
    expect(calls).toBe(2);
    expect(grant.evidence.at(-1)).toMatchObject({
      tool: 'gh_create_or_update_file',
      operation: 'update',
    });
  });

  it('compiles the deployed Azure write schema and separates target from mutable web-test payload', async () => {
    let calls = 0;
    let wrongReceipt = false;
    let wrongPayload = false;
    const bridge: RemoteMcpBridge = {
      prefix: 'az_', label: 'Azure', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [
        {
          name: 'az_monitor_webtests_createorupdate',
          description: 'Create or update an Azure Monitor web test.',
          inputSchema: {
            type: 'object',
            properties: {
              subscription: { type: 'string' },
              'resource-group': { type: 'string' },
              'webtest-resource': { type: 'string' },
              'request-url': { type: 'string' },
              webtest: { type: 'string' },
              enabled: { type: 'boolean' },
              description: { type: 'string' },
            },
            required: ['subscription', 'resource-group', 'webtest-resource'],
            additionalProperties: false,
          },
          moduleId: 'azure',
          execute: async () => ({}),
        },
        {
          name: 'az_monitor_webtests_delete',
          description: 'Delete an Azure Monitor web test.',
          inputSchema: {
            type: 'object',
            properties: {
              subscription: { type: 'string' },
              'resource-group': { type: 'string' },
              'webtest-resource': { type: 'string' },
            },
            required: ['subscription', 'resource-group', 'webtest-resource'],
            additionalProperties: false,
          },
          moduleId: 'azure',
          execute: async () => ({}),
        },
      ],
      call: async () => {
        calls += 1;
        return {
          outcome: 'ok',
          result: {
            webTest: {
              id: '/subscriptions/sub/resourceGroups/Jarvis-RG/providers/Microsoft.Insights/webtests/availability-fixture',
              resourceName: wrongReceipt ? 'wrong-target' : 'Availability-Fixture',
              resourceGroup: 'jarvis-rg',
              webTestName: 'Availability fixture',
              isEnabled: !wrongPayload,
              request: {
                requestUrl: wrongPayload ? 'https://wrong.example.test' : 'https://example.test/health',
              },
            },
          },
        };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Update Azure availability-fixture in Jarvis-RG.');
    const found = await tool('find_tools', {
      turn: grant.turn, query: 'azure monitor web test update',
    });
    expect(found.body?.result.providerContractErrors).toContainEqual({
      tool: 'az_monitor_webtests_delete',
      error: expect.any(String),
    });
    expect(grant.remoteTools.has('az_monitor_webtests_createorupdate')).toBe(true);
    expect(grant.remoteTools.has('az_monitor_webtests_delete')).toBe(false);
    const arguments_ = {
      subscription: 'sub',
      'resource-group': 'Jarvis-RG',
      'webtest-resource': 'availability-fixture',
      'request-url': 'https://example.test/health',
      webtest: 'Availability fixture',
      enabled: true,
      description: 'wrong-target',
    };
    await tool('call_tool', {
      turn: grant.turn,
      name: 'az_monitor_webtests_createorupdate',
      arguments: {
        ...arguments_,
        'webtest-resource': 'wrong-target',
        description: 'availability-fixture',
      },
    });
    expect(calls).toBe(0);

    await tool('call_tool', {
      turn: grant.turn,
      name: 'az_monitor_webtests_createorupdate',
      arguments: arguments_,
    });
    expect(calls).toBe(1);
    expect(grant.evidence.at(-1)).toMatchObject({
      tool: 'az_monitor_webtests_createorupdate',
      operation: 'update',
      domain: 'azure',
    });

    wrongReceipt = true;
    await tool('call_tool', {
      turn: grant.turn,
      name: 'az_monitor_webtests_createorupdate',
      arguments: arguments_,
    });
    expect(calls).toBe(2);
    expect(grant.evidence).toHaveLength(1);
    expect(grant.unverified.count).toBe(1);

    wrongReceipt = false;
    wrongPayload = true;
    await tool('call_tool', {
      turn: grant.turn,
      name: 'az_monitor_webtests_createorupdate',
      arguments: arguments_,
    });
    expect(calls).toBe(3);
    expect(grant.evidence).toHaveLength(1);
    expect(grant.unverified.count).toBe(2);
  });

  it('preserves multi-row remote reads as ambiguous contextual bindings', async () => {
    const calls: string[] = [];
    const bridge: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [
        {
          name: 'gh_get_file_contents',
          description: 'Read repository file contents.',
          inputSchema: {
            type: 'object',
            properties: {
              owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' },
            },
            required: ['owner', 'repo'],
            additionalProperties: false,
          },
          moduleId: 'github', execute: async () => ({}),
        },
        {
          name: 'gh_delete_file',
          description: 'Delete a file.',
          inputSchema: {
            type: 'object',
            properties: {
              owner: { type: 'string' }, repo: { type: 'string' },
              path: { type: 'string' }, branch: { type: 'string' }, message: { type: 'string' },
            },
            required: ['owner', 'repo', 'path', 'branch', 'message'],
            additionalProperties: false,
          },
          moduleId: 'github', execute: async () => ({}),
        },
      ],
      call: async (name) => {
        calls.push(name);
        return name === 'gh_get_file_contents'
          ? {
            outcome: 'ok',
            result: {
              files: [
                { id: 'file-a', path: 'src/a.ts' },
                { id: 'file-b', path: 'src/b.ts' },
              ],
            },
          }
          : { outcome: 'ok', result: { commit: { sha: 'b'.repeat(40) } } };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Read GitHub files in DanAakesen/jarvis.');
    await tool('find_tools', { turn: grant.turn, query: 'github file read delete' });
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_get_file_contents',
      arguments: { owner: 'DanAakesen', repo: 'jarvis' },
    });
    expect(new Set(grant.bindings.at(-1)?.identityTargets.map(
      binding => binding.identityGroupHash,
    )).size).toBe(2);

    grant.completion = completionPlan('Delete it.');
    const deleted = await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_delete_file',
      arguments: {
        owner: 'DanAakesen', repo: 'jarvis',
        path: 'src/a.ts', branch: 'main', message: 'Delete it',
      },
    });
    expect(deleted.body).toMatchObject({ outcome: 'refused' });
    expect(calls).toEqual(['gh_get_file_contents']);
  });

  it('covers production GitHub star, review request and review thread operations', async () => {
    const bridge: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [
        {
          name: 'gh_star_repository',
          description: 'Star a repository.',
          inputSchema: {
            type: 'object',
            properties: { owner: { type: 'string' }, repo: { type: 'string' } },
            required: ['owner', 'repo'], additionalProperties: false,
          },
          moduleId: 'github', execute: async () => ({}),
        },
        {
          name: 'gh_request_copilot_review',
          description: 'Request a Copilot pull request review.',
          inputSchema: {
            type: 'object',
            properties: { owner: { type: 'string' }, repo: { type: 'string' }, pullNumber: { type: 'integer' } },
            required: ['owner', 'repo', 'pullNumber'], additionalProperties: false,
          },
          moduleId: 'github', execute: async () => ({}),
        },
        {
          name: 'gh_pull_request_review_write',
          description: 'Manage a pull request review.',
          inputSchema: {
            type: 'object',
            properties: {
              method: { type: 'string', enum: ['create', 'submit_pending', 'delete_pending', 'resolve_thread', 'unresolve_thread'] },
              owner: { type: 'string' }, repo: { type: 'string' }, pullNumber: { type: 'integer' },
              threadId: { type: 'string' },
            },
            required: ['method', 'owner', 'repo', 'pullNumber'], additionalProperties: false,
          },
          moduleId: 'github', execute: async () => ({}),
        },
      ],
      call: async (name) => ({
        outcome: 'ok',
        result: name === 'gh_star_repository'
          ? { message: 'Successfully starred repository DanAakesen/jarvis' }
          : name === 'gh_request_copilot_review'
            ? { status: 'requested' }
            : { message: 'Review thread un-resolved successfully.' },
      }),
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Star DanAakesen/jarvis on GitHub.');
    await tool('find_tools', { turn: grant.turn, query: 'github repository star review' });
    const star = grant.remoteTools.get('gh_star_repository');
    expect(star?.completion?.evaluate(
      { owner: 'DanAakesen', repo: 'jarvis' },
      'Successfully starred repository DanAakesen/jarvis',
    )).toBe(true);
    expect(star?.completion?.evaluate(
      { owner: 'DanAakesen', repo: 'jarvis' },
      { message: 'Successfully starred repository DanAakesen/jarvis' },
    )).toBe(true);
    await tool('call_tool', {
      turn: grant.turn, name: 'gh_star_repository', arguments: { owner: 'DanAakesen', repo: 'jarvis' },
    });
    expect(grant.evidence.at(-1)).toMatchObject({ tool: 'gh_star_repository', operation: 'update' });

    grant.completion = completionPlan('Request a Copilot review for GitHub pull request 7 in DanAakesen/jarvis.');
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_request_copilot_review',
      arguments: { owner: 'DanAakesen', repo: 'jarvis', pullNumber: 7 },
    });
    expect(grant.evidence.at(-1)).toMatchObject({ tool: 'gh_request_copilot_review', operation: 'update' });

    grant.completion = completionPlan('Unresolve GitHub pull request 7 review thread thread-1.');
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_pull_request_review_write',
      arguments: {
        method: 'unresolve_thread', owner: 'DanAakesen', repo: 'jarvis',
        pullNumber: 7, threadId: 'thread-1',
      },
    });
    expect(grant.evidence.at(-1)).toMatchObject({
      tool: 'gh_pull_request_review_write', operation: 'update',
    });
  });

  it('binds remote delete receipts to the exact requested target', async () => {
    let calls = 0;
    const bridge: RemoteMcpBridge = {
      prefix: 'gh_', label: 'GitHub', status: () => ({ state: 'ready' }), warm: () => {},
      tools: async () => [{
        name: 'gh_delete_file',
        description: 'Delete a file.',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' }, repo: { type: 'string' },
            path: { type: 'string' }, branch: { type: 'string' },
          },
          required: ['owner', 'repo', 'path', 'branch'],
          additionalProperties: false,
        },
        moduleId: 'github',
        execute: async () => ({}),
      }],
      call: async () => {
        calls += 1;
        return {
          outcome: 'ok',
          result: {
            commit: { sha: 'b'.repeat(40), message: 'Delete src/example.ts' },
            content: null,
          },
        };
      },
    };
    const { registry, tool } = setup([bridge]);
    const grant = registry.open({ ownerObjectId: config.auth.ownerObjectId, sessionId: '7', messageId: '42', signal: live() });
    grant.completion = completionPlan('Delete GitHub file src/example.ts in DanAakesen/jarvis on main.');
    await tool('find_tools', { turn: grant.turn, query: 'github delete file' });
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_delete_file',
      arguments: { owner: 'DanAakesen', repo: 'jarvis', path: 'src/example.ts', branch: 'main' },
    });
    expect(calls).toBe(1);
    expect(grant.evidence).toMatchObject([{
      executionId: 'remote:gh_:gh_delete_file',
      operation: 'delete',
      kind: 'committed',
    }]);
    await tool('call_tool', {
      turn: grant.turn,
      name: 'gh_delete_file',
      arguments: { owner: 'DanAakesen', repo: 'jarvis', path: 'src/wrong.ts', branch: 'main' },
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
