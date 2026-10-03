import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { coreModule } from './core/index.js';
import { factoryModule } from './factory/index.js';
import type { JarvisTool } from './core/tool-registry.js';
import type { BackendModule } from './modules.js';

const config = { port: 3000, logLevel: 'silent' as const };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function fixture(modules: readonly BackendModule[]) {
  const app = buildApp(config, undefined, { modules: [coreModule, factoryModule, ...modules] });
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
    expect((await app.inject({ method: 'POST', url: '/extension/echo', payload: { text: 'hello' } })).json()).toEqual({ text: 'hello' });
    expect((await app.inject({ method: 'POST', url: '/extension/echo', payload: {} })).statusCode).toBe(400);
    expect(app.jarvisTools.list()).toEqual([expect.objectContaining({ name: 'extension_echo', moduleId: 'extension' })]);
    expect(app.jarvisTools.get('missing')).toBeUndefined();
  });

  it('inherits root CORS and authentication hooks and isolates sibling plugin state', async () => {
    const app = fixture([extension('first'), extension('second')]);
    app.addHook('onRequest', async (request, reply) => {
      if (request.url !== '/health' && request.headers.authorization !== 'Bearer test') return reply.code(401).send({ error: 'Unauthorized' });
    });
    expect((await app.inject({ url: '/first' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/first', headers: { authorization: 'Bearer test', origin: 'https://evil.example' } })).statusCode).toBe(403);
    const allowed = await app.inject({ url: '/second', headers: { authorization: 'Bearer test', origin: 'http://localhost:5173' } });
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
    expect(second.jarvisTools.list()).toEqual([]);
  });

  it('does not advertise unimplemented factory or core APIs or tools', async () => {
    const app = fixture([]);
    expect(app.jarvisTools.list()).toEqual([]);
    for (const url of ['/factory/projects', '/factory/tasks', '/settings', '/activity', '/events']) {
      expect((await app.inject({ url })).statusCode).toBe(404);
    }
  });
});
