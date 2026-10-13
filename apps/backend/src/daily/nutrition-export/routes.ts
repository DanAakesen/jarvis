import type { FastifyInstance,FastifyRequest } from 'fastify';
import type sql from 'mssql';
import { AuthenticationDenied } from '../../auth/verify.js';
import { resolveExportDevice } from './auth.js';
import { NutritionExportStore } from './store.js';
import { claimInput,completion,ExportConflict,ExportUnavailable,type ClaimInput,type Completion } from './model.js';

export interface ExportDeviceService {
  claim(input: ClaimInput,signal: AbortSignal): ReturnType<NutritionExportStore['claim']>;
  complete(input: Completion,signal: AbortSignal): ReturnType<NutritionExportStore['complete']>;
}
/** Explicit test/future composition only. Not called from index, production modules or Daily flags. */
export async function registerNutritionExportRoutes(app: FastifyInstance,storeFor: (request: FastifyRequest) => ExportDeviceService) {
  for (const action of ['claim','complete'] as const) app.post(`/daily/nutrition/export/${action}`,{
    config: { jarvisNutritionExport: true },bodyLimit: 16 * 1024,
  },async (request,reply) => {
    reply.header('Cache-Control','no-store');
    const controller = new AbortController(); const disconnected = () => controller.abort();
    request.raw.once('aborted',disconnected);
    const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]);
    try {
      resolveExportDevice(request);
      if (Object.keys(request.query as object).length !== 0) throw new TypeError('Invalid request');
      // Strict typed validation rejects model/client owner and credential selectors.
      if (action === 'claim') {
        const input = claimInput(request.body as ClaimInput);
        return await storeFor(request).claim(input,signal);
      }
      completion(request.body as Completion);
      return await storeFor(request).complete(request.body as Completion,signal);
    } catch (error) {
      if (error instanceof AuthenticationDenied) return reply.code(error.statusCode).send({ error: 'Forbidden' });
      if (error instanceof TypeError) return reply.code(400).send({ error: 'Invalid export request' });
      if (error instanceof ExportConflict) return reply.code(409).send({ error: 'Export state conflict; reconcile before retrying' });
      if (error instanceof ExportUnavailable || signal.aborted) return reply.code(503).send({ error: 'Export unavailable; no native write is claimed' });
      return reply.code(503).send({ error: 'Export unavailable; no native write is claimed' });
    } finally { request.raw.removeListener('aborted',disconnected); }
  });
}
export function nutritionExportRoutes(pool: sql.ConnectionPool) {
  return (app: FastifyInstance) => registerNutritionExportRoutes(app,(request) => NutritionExportStore.forDevice(pool,request));
}
