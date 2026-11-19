import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { piMcpPath, type PiAuth } from '../auth/pi-credential.js';
import { PiGatewayError } from './errors.js';
import type { PiGateway, PiStatus } from './gateway.js';
import { createPiMcpRoutes } from './mcp.js';
import type { RemoteMcpBridge } from './remote-mcp.js';
import { piSmokeParts, runPiSmoke, type PiSmokePart } from './smoke.js';
import type { PiTurnRegistry } from './turns.js';
import type { BrainControl } from './brain/control.js';
import { PI_MODEL, PI_REASONING_EFFORT } from './definition.js';

export interface PiModuleOptions {
  /** Absent until the Deploy workflow has provisioned the agent and given the backend its name and MCP secret. */
  readonly gateway?: PiGateway | undefined;
  readonly registry: PiTurnRegistry;
  readonly auth: PiAuth;
  readonly monthlyCapDkk: number;
  /** The owner's test switch and status for the brain; absent when the brain is not wired on this backend. */
  readonly brain?: BrainControl | undefined;
  /** GitHub's and Azure's tools, reached through the Jarvis MCP door. Each is present only when it is configured. */
  readonly bridges?: readonly RemoteMcpBridge[] | undefined;
}

const isOwner = (app: FastifyInstance, objectId: string | undefined) => objectId?.toLowerCase() === app.ownerObjectId.toLowerCase();

const errorBody = (error: unknown) => error instanceof PiGatewayError
  ? { error: error.userMessage, code: error.code, ...(error.detail ? { detail: error.detail } : {}) }
  : { error: 'PI could not be reached. No other engine was used.', code: 'pi_unavailable' };

/** The test-only PI surface: status for the Settings switch, a warm-up the app calls when it opens, the MCP door, and the deploy smoke. */
export function createPiRoutes(options: PiModuleOptions): FastifyPluginAsync {
  return async (app) => {
    app.get('/pi/status', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!isOwner(app, request.principal?.objectId)) return reply.code(403).send({ error: 'Forbidden' });
      if (!options.gateway) {
        const unconfigured: PiStatus = {
          enabled: false, reason: 'not_configured', agent: { name: null, model: PI_MODEL, effort: PI_REASONING_EFFORT },
          month: { spentDkk: 0, capDkk: options.monthlyCapDkk, remainingDkk: options.monthlyCapDkk, turns: 0 }, warm: { state: 'cold', warmedAt: null }, lastTurn: null,
        };
        return unconfigured;
      }
      try { return await options.gateway.status(AbortSignal.timeout(10_000)); } catch {
        return reply.code(503).send({ error: 'PI status could not be read.', code: 'pi_unavailable' });
      }
    });

    app.post('/pi/warm', { schema: { body: { type: ['object', 'null'], additionalProperties: false } } }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!isOwner(app, request.principal?.objectId)) return reply.code(403).send({ error: 'Forbidden' });
      if (!options.gateway) {
        return reply.code(503).send({ error: 'PI is not set up on this backend yet. No other engine was used.', code: 'pi_not_configured' });
      }
      // Starts a remote server that scales to zero (Azure) and reads the catalogues now, so the first search does not wait for them.
      for (const bridge of options.bridges ?? []) bridge.warm();
      const controller = new AbortController();
      request.raw.once('aborted', () => controller.abort());
      try { return await options.gateway.warm(AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)])); } catch (error) {
        return reply.code(503).send(errorBody(error));
      }
    });

    app.get('/pi/brain', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!isOwner(app, request.principal?.objectId)) return reply.code(403).send({ error: 'Forbidden' });
      if (!options.brain || !options.gateway) return reply.code(503).send({ error: 'The PI brain is not set up on this backend yet.', code: 'pi_not_configured' });
      try { return await options.brain.read(AbortSignal.timeout(10_000)); } catch {
        return reply.code(503).send({ error: 'The PI brain status could not be read.', code: 'pi_unavailable' });
      }
    });

    app.put<{ Body: { enabled: boolean } }>('/pi/brain', {
      schema: { body: { type: 'object', additionalProperties: false, required: ['enabled'], properties: { enabled: { type: 'boolean' } } } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!isOwner(app, request.principal?.objectId)) return reply.code(403).send({ error: 'Forbidden' });
      if (!options.brain || !options.gateway) return reply.code(503).send({ error: 'The PI brain is not set up on this backend yet.', code: 'pi_not_configured' });
      try { return await options.brain.write(request.body.enabled, AbortSignal.timeout(10_000)); } catch {
        return reply.code(503).send({ error: 'The PI brain switch could not be saved.', code: 'pi_unavailable' });
      }
    });

    if (!options.gateway) return;
    const gateway = options.gateway;
    // Wake a server that scales from zero (Azure) as the backend starts, so its first search does not find it asleep.
    for (const bridge of options.bridges ?? []) bridge.warm();
    await app.register(createPiMcpRoutes({ registry: options.registry, auth: options.auth, bridges: options.bridges }));

    app.post<{ Body: { part: PiSmokePart } }>('/pi/smoke', { config: { jarvisDeploySmoke: true }, schema: { body: { type: 'object', required: ['part'], additionalProperties: false, properties: { part: { enum: [...piSmokeParts] } } } } },
      async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!request.deployPrincipal) return reply.code(403).send({ error: 'Forbidden' });
        try {
          const status = await gateway.status(AbortSignal.timeout(10_000));
          if (!status.enabled) return reply.code(409).send({ error: 'PI is over its monthly cap; the smoke did not run.', code: 'pi_budget_exhausted' });
          const report = await runPiSmoke(gateway, AbortSignal.timeout(220_000), { bridges: options.bridges, part: request.body.part });
          if (report.part === 'core' || report.part === 'voice') {
            app.systemStatusReader.recordEvidence(
              report.part === 'voice' ? 'foundry.voice' : 'foundry.chat',
              {
                status: Object.values(report.checks).every(Boolean) ? 'ok' : 'degraded',
                checkedAt: new Date().toISOString(),
                details: {
                  engine: 'pi',
                  evidence: 'deploy-smoke',
                  smokePart: report.part,
                },
              },
            );
          }
          return report;
        } catch (error) {
          if (request.body.part === 'core' || request.body.part === 'voice') {
            app.systemStatusReader.recordEvidence(
              request.body.part === 'voice' ? 'foundry.voice' : 'foundry.chat',
              {
                status: 'down',
                checkedAt: new Date().toISOString(),
                details: {
                  engine: 'pi',
                  evidence: 'deploy-smoke',
                  smokePart: request.body.part,
                  reason: 'smoke_failed',
                },
              },
            );
          }
          request.log.warn({ code: error instanceof PiGatewayError ? error.code : 'unknown' }, 'pi.smoke_failed');
          return reply.code(502).send(errorBody(error));
        }
      });
  };
}

export { piMcpPath };
