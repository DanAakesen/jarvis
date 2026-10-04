import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { coreModule } from './core/index.js';
import { factoryModule } from './factory/index.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from './core/tool-registry.js';
import type { BackendModule } from './modules.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: 'Bearer a.b.c' };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(modules: readonly BackendModule[]) {
  const app = buildApp(config, undefined, {
    modules: [coreModule, factoryModule, ...modules],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
  });
  apps.push(app);
  return app;
}

function extension(id = 'extension', tools: readonly JarvisTool[] = []): BackendModule {
  return {
    id, tools,
    registerRoutes: async (app) => {
      app.decorate('localState', id);
      app.get(`/${id}`, async () => ({ module: id }));
    },
  };
}

describe('backend module composition', () => {
  it('lists tools from every module and executes them through their schema-validated routes', async () => {
    const execute = vi.fn(async (input: unknown) => input);
    const record = vi.fn(async () => {});
    const tool: JarvisTool = {
      name: 'extension_echo', description: 'Echo a validated test input',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      execute,
    };
    const app = buildApp(config, undefined, {
      modules: [coreModule, factoryModule, extension('extension', [tool])],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      toolCallStore: { record },
    });
    apps.push(app);

    const listed = await app.inject({ url: '/tools', headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      ...factoryModule.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
    ]);

    const called = await app.inject({
      method: 'POST', url: '/tools/extension_echo', headers: { ...headers, 'x-jarvis-message-id': '42' },
      payload: { text: 'hello' },
    });
    expect(called.statusCode).toBe(200);
    expect(called.json()).toEqual({
      tool: 'extension_echo', outcome: 'ok', result: { text: 'hello' }, confirmation: 'Done: extension_echo succeeded.',
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      messageId: '42', tool: 'extension_echo', arguments: { text: 'hello' },
      result: { text: 'hello' }, outcome: 'ok',
    });

    const invalid = await app.inject({
      method: 'POST', url: '/tools/extension_echo', headers: { ...headers, 'x-jarvis-message-id': '42' },
      payload: {},
    });
    expect(invalid.statusCode).toBe(400);
    expect(execute).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect((await app.inject({ method: 'POST', url: '/tools/missing', headers })).statusCode).toBe(404);
  });

  it('does not execute without persistence and records sanitized tool failures', async () => {
    const execute = vi.fn(async () => { throw new Error('sensitive provider detail'); });
    const record = vi.fn(async () => {});
    const tool: JarvisTool = {
      name: 'extension_failure', description: 'Fails safely',
      inputSchema: { type: 'object', additionalProperties: false },
      execute,
    };
    const unavailable = fixture([extension('extension', [tool])]);
    expect((await unavailable.inject({ url: '/tools', headers })).statusCode).toBe(200);
    expect((await unavailable.inject({
      method: 'POST', url: '/tools/extension_failure', headers: { ...headers, 'x-jarvis-message-id': '42' }, payload: {},
    })).statusCode).toBe(503);
    expect(execute).not.toHaveBeenCalled();

    const denied = buildApp(config, undefined, { modules: [coreModule, factoryModule, extension('extension', [tool])] });
    apps.push(denied);
    expect((await denied.inject({ url: '/tools' })).statusCode).toBe(401);
    expect((await denied.inject({
      method: 'POST', url: '/tools/extension_failure', headers: { 'x-jarvis-message-id': '42' }, payload: {},
    })).statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();

    const app = buildApp(config, undefined, {
      modules: [coreModule, factoryModule, extension('extension', [tool])],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      toolCallStore: { record },
    });
    apps.push(app);
    const failed = await app.inject({
      method: 'POST', url: '/tools/extension_failure', headers: { ...headers, 'x-jarvis-message-id': '42' }, payload: {},
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual({
      tool: 'extension_failure', outcome: 'error', result: { error: 'Tool execution failed' },
      confirmation: 'Not done: extension_failure failed.',
    });
    expect(record).toHaveBeenCalledWith({
      messageId: '42', tool: 'extension_failure', arguments: {}, result: { error: 'Tool execution failed' }, outcome: 'error',
    });
    expect(failed.body).not.toContain('sensitive provider detail');
  });

  it('reports a refused tool call as refused, never as done', async () => {
    const record = vi.fn(async () => {});
    const refusing: JarvisTool = {
      name: 'extension_refuse', description: 'Refuses with a safe reason',
      inputSchema: { type: 'object' },
      execute: async () => { throw new ToolRefusal('Task T-101 is already running.'); },
    };
    const invalidRefusal: JarvisTool = {
      name: 'extension_bad_refusal', description: 'Refuses without a reason',
      inputSchema: { type: 'object' },
      execute: async () => { throw new ToolRefusal('  '); },
    };
    const app = buildApp(config, undefined, {
      modules: [coreModule, factoryModule, extension('extension', [refusing, invalidRefusal])],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      toolCallStore: { record },
    });
    apps.push(app);

    const refused = await app.inject({
      method: 'POST', url: '/tools/extension_refuse', headers: { ...headers, 'x-jarvis-message-id': '42' }, payload: {},
    });
    expect(refused.statusCode).toBe(200);
    expect(refused.json()).toEqual({
      tool: 'extension_refuse', outcome: 'refused', result: { refused: 'Task T-101 is already running.' },
      confirmation: 'Not done: extension_refuse was refused. Task T-101 is already running.',
    });
    expect(record).toHaveBeenCalledWith({
      messageId: '42', tool: 'extension_refuse', arguments: {},
      result: { refused: 'Task T-101 is already running.' }, outcome: 'refused',
    });

    const malformed = await app.inject({
      method: 'POST', url: '/tools/extension_bad_refusal', headers: { ...headers, 'x-jarvis-message-id': '42' }, payload: {},
    });
    expect(malformed.json()).toMatchObject({ outcome: 'error', confirmation: 'Not done: extension_bad_refusal failed.' });
  });

  it('returns safe, tool-specific failure explanations without changing the error outcome', async () => {
    const record = vi.fn(async () => {});
    const tool: JarvisTool = {
      name: 'extension_failure_explained',
      description: 'Fails with a safe explanation.',
      inputSchema: { type: 'object' },
      execute: async () => { throw new ToolFailure('Notes search is temporarily unavailable.'); },
    };
    const app = buildApp(config, undefined, {
      modules: [coreModule, factoryModule, extension('extension', [tool])],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      toolCallStore: { record },
    });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/tools/extension_failure_explained',
      headers: { ...headers, 'x-jarvis-message-id': '42' },
      payload: {},
    });

    expect(response.json()).toEqual({
      tool: 'extension_failure_explained',
      outcome: 'error',
      result: { error: 'Notes search is temporarily unavailable.' },
      confirmation: 'Not done: extension_failure_explained failed.',
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      result: { error: 'Notes search is temporarily unavailable.' },
      outcome: 'error',
    }));
  });

  it('rejects malformed message IDs before executing a tool', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const tool: JarvisTool = {
      name: 'extension_echo', description: 'Echo',
      inputSchema: { type: 'object' }, execute,
    };
    const record = vi.fn(async () => {});
    const app = buildApp(config, undefined, {
      modules: [coreModule, factoryModule, extension('extension', [tool])],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      toolCallStore: { record },
    });
    apps.push(app);
    for (const messageId of ['0', '-1', '9223372036854775808', 'not-an-id']) {
      const response = await app.inject({
        method: 'POST', url: '/tools/extension_echo', headers: { ...headers, 'x-jarvis-message-id': messageId }, payload: {},
      });
      expect(response.statusCode).toBe(400);
    }
    expect(execute).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('does not report success if recording the tool result fails', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const tool: JarvisTool = {
      name: 'extension_echo', description: 'Echo',
      inputSchema: { type: 'object' }, execute,
    };
    const app = buildApp(config, undefined, {
      modules: [coreModule, factoryModule, extension('extension', [tool])],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
      toolCallStore: { record: async () => { throw new Error('database-secret'); } },
    });
    apps.push(app);
    const response = await app.inject({
      method: 'POST', url: '/tools/extension_echo', headers: { ...headers, 'x-jarvis-message-id': '42' }, payload: {},
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal server error' });
    expect(response.body).not.toContain('database-secret');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('adds a third module with routes and a Jarvis tool through composition alone', async () => {
    const tool: JarvisTool = {
      name: 'extension_echo', description: 'Echo a validated test input',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      execute: async (input, request, signal) => {
        expect(request.method).toBe('POST');
        expect(signal.aborted).toBe(false);
        return input;
      },
    };
    const app = fixture([{
      id: 'extension', tools: [tool],
      registerRoutes: async (scope) => {
        scope.post('/extension/echo', { schema: { body: tool.inputSchema } }, async (request) => {
          const registered = scope.jarvisTools.get(tool.name);
          if (!registered) throw new Error('Tool registration missing');
          return registered.execute(request.body, request, new AbortController().signal);
        });
      },
    }]);
    expect((await app.inject({ url: '/health' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'POST', url: '/extension/echo', headers, payload: { text: 'hello' } })).json()).toEqual({ text: 'hello' });
    expect((await app.inject({ method: 'POST', url: '/extension/echo', headers, payload: {} })).statusCode).toBe(400);
    expect(app.jarvisTools.list()).toHaveLength(factoryModule.tools.length + 1);
    expect(app.jarvisTools.get(tool.name)).toMatchObject({ name: 'extension_echo', moduleId: 'extension' });
    expect(app.jarvisTools.get('missing')).toBeUndefined();
  });

  it('inherits root CORS and authentication hooks and isolates sibling plugin state', async () => {
    const app = fixture([extension('first'), extension('second')]);
    expect((await app.inject({ url: '/first' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/first', headers: { ...headers, origin: 'https://evil.example' } })).statusCode).toBe(403);
    const allowed = await app.inject({ url: '/second', headers: { ...headers, origin: 'http://localhost:5173' } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.json()).toEqual({ module: 'second' });
    expect(app.hasDecorator('localState')).toBe(false);
  });

  it('awaits module startup and owns module shutdown through Fastify', async () => {
    const started = vi.fn();
    const closed = vi.fn();
    const app = fixture([{ id: 'lifecycle', tools: [], registerRoutes: async (scope) => {
      await Promise.resolve();
      started();
      scope.addHook('onClose', async () => { closed(); });
    } }]);
    expect(started).not.toHaveBeenCalled();
    await app.ready();
    expect(started).toHaveBeenCalledOnce();
    await app.close();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('refuses startup when a module fails rather than serving partial application routes', async () => {
    const app = fixture([{ id: 'failure', tools: [], registerRoutes: async () => { throw new Error('Module startup failed'); } }]);
    await expect(app.ready()).rejects.toThrow('Module startup failed');
  });

  it('rejects duplicate module IDs before any registration can run', () => {
    const registerRoutes = vi.fn(async () => {});
    expect(() => fixture([extension(), { id: 'extension', tools: [], registerRoutes }])).toThrow('Invalid or duplicate backend module ID');
    expect(registerRoutes).not.toHaveBeenCalled();
    expect(() => fixture([extension('../invalid')])).toThrow('Invalid or duplicate backend module ID');
  });

  it('rejects ambiguous or invalid tools at startup', () => {
    const tool: JarvisTool = { name: 'echo', description: 'Echo', inputSchema: { type: 'object' }, execute: async (input) => input };
    expect(() => fixture([extension('one', [tool]), extension('two', [tool])])).toThrow('Invalid or duplicate Jarvis tool');
    expect(() => fixture([extension('one', [{ ...tool, name: 'bad name' }])])).toThrow('Invalid or duplicate Jarvis tool');
    expect(() => fixture([extension('one', [{ ...tool, inputSchema: { type: 'array' } }])])).toThrow('Invalid Jarvis tool contract');
  });

  it('keeps each app catalogue separate and snapshots schemas against later mutations', async () => {
    const schema = { type: 'object', properties: { text: { type: 'string' } } };
    const tool: JarvisTool = { name: 'echo', description: 'Echo', inputSchema: schema, execute: async (input) => input };
    const first = fixture([extension('one', [tool])]);
    const second = fixture([]);
    schema.properties.text.type = 'number';
    await Promise.all([first.ready(), second.ready()]);
    expect(first.jarvisTools.get('echo')?.inputSchema).toEqual({ type: 'object', properties: { text: { type: 'string' } } });
    expect(Object.isFrozen(first.jarvisTools.get('echo')?.inputSchema.properties)).toBe(true);
    expect(Object.isFrozen(first.jarvisTools.list())).toBe(true);
    expect(second.jarvisTools.list().map(({ name }) => name)).toEqual(factoryModule.tools.map(({ name }) => name));
  });

  it('keeps unimplemented APIs unavailable and reports missing task and settings storage', async () => {
    const app = fixture([]);
    expect(app.jarvisTools.list().map(({ name }) => name)).toEqual(factoryModule.tools.map(({ name }) => name));
    expect((await app.inject({ url: '/factory/projects', headers })).statusCode).toBe(503);
    for (const url of ['/activity', '/events']) {
      expect((await app.inject({ url, headers })).statusCode).toBe(404);
    }
    expect((await app.inject({ url: '/factory/tasks', headers })).statusCode).toBe(503);
    expect((await app.inject({ url: '/settings', headers })).statusCode).toBe(503);
    expect((await app.inject({
      method: 'PATCH', url: '/settings', headers, payload: { settings: { jarvis: { reasoning: 'low' } } },
    })).statusCode).toBe(503);
  });
});
