import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { InMemoryOwnerSessionStore } from '../../auth/session/memory-store.js';
import { OwnerSessionService } from '../../auth/session/service.js';
import { loadConfig } from '../../config.js';
import { createLogger } from '../../logging.js';
import { serveLegacyDailyAlias } from '../legacy-alias.js';
import { emptyNutritionTargets } from '../nutrition/targets.js';
import { emptyTrainingTargets } from '../training/targets.js';
import { nutritionTargetsRoutes } from './nutrition-targets.js';
import { trainingTargetsRoutes } from './training-targets.js';

describe('native Settings target reads and edits with an owner session', () => {
  const config = loadConfig({ JARVIS_OWNER_SESSION_ENABLED: 'true', ENTRA_OWNER_OBJECT_ID: 'f00abaaa-1111-4111-8111-111111111111' });
  const ownerSessions = new OwnerSessionService({
    store: new InMemoryOwnerSessionStore(), ownerObjectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId,
  });
  let training = emptyTrainingTargets;
  let nutrition = emptyNutritionTargets;
  const stamp = '2026-11-22T18:05:43.917Z';
  const app = buildApp(config, createLogger({ logLevel: 'fatal' }), {
    ownerSessions,
    modules: [{
      id: 'health', tools: [],
      async registerRoutes(server) {
        serveLegacyDailyAlias(server);
        await server.register(trainingTargetsRoutes(() => ({
          read: async () => ({ targets: training, updatedAt: training === emptyTrainingTargets ? null : stamp }),
          write: async patch => {
            training = { ...training, ...patch };
            return { targets: training, updatedAt: stamp };
          },
        })));
        await server.register(nutritionTargetsRoutes(() => ({
          read: async () => ({ targets: nutrition, updatedAt: nutrition === emptyNutritionTargets ? null : stamp }),
          write: async patch => {
            nutrition = { ...nutrition, ...patch };
            return { targets: nutrition, updatedAt: stamp };
          },
        })));
      },
    }],
  });
  let authorization: string;
  beforeAll(async () => {
    const session = await ownerSessions.create({ ownerObjectId: config.auth.ownerObjectId, displayName: 'Owner', deviceLabel: 'Test iPhone' });
    authorization = 'Bearer ' + session.token;
  });
  afterAll(() => app.close());

  it.each([['training', 'gymSessionsPerWeek', 3], ['nutrition', 'deficitKcal', 0]] as const)(
    'opens, changes and rereads %s targets', async (kind, field, value) => {
      const url = `/health/${kind}-targets`;
      const headers = { authorization, accept: 'application/json' };
      const initial = await app.inject({ method: 'GET', url, headers });
      expect(initial.statusCode).toBe(200);
      expect(initial.headers['content-type']).toMatch(/^application\/json\b/);
      expect(initial.headers['cache-control']).toBe('no-store');
      expect(initial.json()).toMatchObject({ targets: { [field]: null }, missing: expect.arrayContaining([field]), updatedAt: null });
      const saved = await app.inject({ method: 'PATCH', url, headers, payload: { [field]: value } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ targets: { [field]: value }, bounds: { [field]: { min: 0 } }, updatedAt: stamp });
      expect(saved.json().missing).not.toContain(field);
      const reopened = await app.inject({ method: 'GET', url, headers });
      expect(reopened.json()).toEqual(saved.json());
    });
});
