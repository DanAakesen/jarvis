import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as engineModule from './engine.js';
import * as todoWriterModule from './todo-writer.js';
import { registerProactive } from './composition.js';

const owner = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('dark proactive todo writer composition', () => {
  it('does not construct or register the writer when its flag is off', async () => {
    const vaultClient = {
      tree: vi.fn(async () => []),
      read: vi.fn(async () => null),
      write: vi.fn(async () => 'a'.repeat(40)),
      delete: vi.fn(async () => { throw new Error('delete must never be used'); }),
    };
    const existingHook = vi.fn();
    const createEngine = vi.spyOn(engineModule, 'createProactiveEngine');
    const createTodoWriter = vi.spyOn(todoWriterModule, 'createProactiveTodoWriter');
    const app = Fastify({ logger: false });
    apps.push(app);

    registerProactive(app, {
      enabled: true,
      ownerObjectId: owner,
      vaultClient: vaultClient as never,
      todoWritesEnabled: false,
      onFindingsStored: [existingHook],
      now: () => new Date('2026-10-18T01:00:00.000Z'),
    });
    await app.ready();

    expect(createTodoWriter).not.toHaveBeenCalled();
    expect(createEngine.mock.calls[0]?.[0].onFindingsStored).toEqual([existingHook]);
    expect(vaultClient.tree).not.toHaveBeenCalled();
    expect(vaultClient.read).not.toHaveBeenCalled();
    expect(vaultClient.write).not.toHaveBeenCalled();
    expect(vaultClient.delete).not.toHaveBeenCalled();
  });

  it('does not write without durable SQL receipt storage, even when the writer flag is on', async () => {
    const vaultClient = {
      tree: vi.fn(async () => []),
      read: vi.fn(async () => null),
      write: vi.fn(async () => 'a'.repeat(40)),
      delete: vi.fn(async () => { throw new Error('delete must never be used'); }),
    };
    const createTodoWriter = vi.spyOn(todoWriterModule, 'createProactiveTodoWriter');
    const app = Fastify({ logger: false });
    apps.push(app);

    registerProactive(app, {
      enabled: true,
      ownerObjectId: owner,
      vaultClient: vaultClient as never,
      todoWritesEnabled: true,
      now: () => new Date('2026-10-18T01:00:00.000Z'),
    });
    await app.ready();

    expect(createTodoWriter).not.toHaveBeenCalled();
    expect(vaultClient.tree).not.toHaveBeenCalled();
    expect(vaultClient.read).not.toHaveBeenCalled();
    expect(vaultClient.write).not.toHaveBeenCalled();
  });
});
