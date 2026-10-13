import Fastify,{ type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { authorizeHealth,healthUploadLimit,metadataLimit,opaqueId,sha256,HealthConflict,HealthDenied,HealthUnavailable,
  type HealthCapability,type HealthCredentialVerifier,type HealthKind } from './contracts.js';
import type { AzureHealthBuffer,UploadIdentity } from './azure-buffer.js';

declare module 'fastify' { interface FastifyRequest { healthUploadCapability: HealthCapability | null; healthUploadIdentity: UploadIdentity | null; healthUploadRelease: (() => void) | null; healthHeartbeatName: string | null } }
const routes = { '/api/health/ingest': 'upload','/api/health/heartbeat': 'heartbeat' } as const;
function header(request: FastifyRequest,name: string): string | undefined {
  if (request.raw.rawHeaders.filter((value,i) => i % 2 === 0 && value.toLowerCase() === name).length > 1) throw new TypeError('Duplicate header');
  const value = request.headers[name]; if (value !== undefined && typeof value !== 'string') throw new TypeError('Invalid header');
  return value;
}
/** Dedicated factory only; absent enable/configuration fails closed. No main registration, SQL or agent dependency. */
export function buildHealthUploadServer(options: { enabled?: boolean; buffer?: AzureHealthBuffer; verifier?: HealthCredentialVerifier } = {}) {
  const app = Fastify({ logger: false,bodyLimit: healthUploadLimit,requestTimeout: 30000,maxRequestsPerSocket: 100 });
  app.get('/health',async () => ({ acceptance: options.enabled === true && options.buffer && options.verifier ? 'configured' : 'inactive',processing: 'not-configured' }));
  app.setNotFoundHandler((_request,reply) => reply.code(404).send({ error: 'Not found' }));
  app.setErrorHandler((error,_request,reply) => {
    const code = error instanceof HealthDenied ? 403 : error instanceof HealthConflict ? 409 : error instanceof TypeError ? 400
      : (error as { statusCode?: number }).statusCode === 429 ? 429
      : (error as { statusCode?: number }).statusCode === 413 ? 413 : (error as { statusCode?: number }).statusCode === 415 ? 415 : 503;
    reply.header('Cache-Control','no-store').code(code).send({ error: code === 403 ? 'Health capability denied' : code === 409 ? 'Health session conflict'
      : code === 413 ? 'Health upload exceeds limit' : code === 415 ? 'JSON required' : code === 400 ? 'Invalid health request' : 'Health acceptance unavailable' });
  });
  if (options.enabled !== true) return app;
  app.decorateRequest('healthUploadCapability',null); app.decorateRequest('healthUploadIdentity',null);
  app.decorateRequest('healthUploadRelease',null); let active = 0;
  app.decorateRequest('healthHeartbeatName',null);
  app.addHook('onResponse',async request => request.healthUploadRelease?.());
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json',{ parseAs: 'buffer',bodyLimit: healthUploadLimit },(_request,body,done) => {
    if (_request.routeOptions.url === '/api/health/heartbeat') { done(null,body); return; }
    try { JSON.parse(new TextDecoder('utf-8',{ fatal: true }).decode(body as Buffer)); done(null,body); }
    catch { done(new TypeError('Invalid JSON')); }
  });
  app.addContentTypeParser('*',{ parseAs: 'buffer',bodyLimit: healthUploadLimit },(request,body,done) => {
    if (request.routeOptions.url === '/api/health/heartbeat') done(null,body);
    else done(Object.assign(new Error('JSON required'),{ statusCode: 415 }));
  });
  app.addHook('onRequest',async request => {
    const kind: HealthKind | undefined = routes[request.routeOptions.url as keyof typeof routes];
    if (!kind) return;
    if (!options.verifier || !options.buffer) throw new HealthUnavailable();
    if (active >= 8) throw Object.assign(new Error('Busy'),{ statusCode: 429 });
    active++;
    let released = false;
    const release = () => { if (!released) { released = true; active--; request.raw.socket.removeListener('close',release); } };
    request.healthUploadRelease = release; request.raw.socket.once('close',release);
    if (Object.keys(request.query as object).length || header(request,'content-encoding') && header(request,'content-encoding') !== 'identity') throw new TypeError('Invalid request');
    const authorization = header(request,'authorization');
    const match = typeof authorization === 'string' ? /^[Bb][Ee][Aa][Rr][Ee][Rr] ([A-Za-z0-9_-]{43,256})$/u.exec(authorization) : null;
    if (!match) throw new HealthDenied();
    const signal = AbortSignal.timeout(10000);
    const capability = await options.verifier(match[1]!,signal); signal.throwIfAborted();
    request.healthUploadCapability = authorizeHealth(capability,options.buffer.owner,kind === 'upload' ? 'health-ingest' : 'health-heartbeat');
    const automation = header(request,'automation-id'); const session = header(request,'session-id');
    if (automation !== undefined) opaqueId(automation); if (session !== undefined) opaqueId(session);
    if (kind === 'upload' && (!automation || !session)) throw new TypeError('Missing upload identity');
    request.healthUploadIdentity = { automationId: automation ?? 'heartbeat',sessionId: session ?? randomUUID() };
    if (kind === 'heartbeat') {
      const name = header(request,'shortcut-name') ?? 'Daily Overview heartbeat';
      opaqueId(name,256); request.healthHeartbeatName = name;
    } else for (const name of ['checksum','x-payload-checksum']) { const checksum = header(request,name); if (checksum !== undefined && !/^[a-f\d]{64}$/iu.test(checksum)) throw new TypeError('Invalid checksum'); }
  });
  for (const [url,kind] of Object.entries(routes)) app.post(url,{ bodyLimit: kind === 'heartbeat' ? metadataLimit : healthUploadLimit },async (request,reply) => {
    reply.header('Cache-Control','no-store');
    // Source heartbeat reads headers, not a body. Retain only bounded private provenance.
    const body = kind === 'heartbeat' ? Buffer.from(JSON.stringify({ shortcutName: request.healthHeartbeatName,checkedFeeds: ['metrics','workouts'] })) : request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new TypeError('Invalid JSON body');
    const checksum = sha256(body);
    if (kind === 'upload') for (const name of ['checksum','x-payload-checksum']) { const expected = header(request,name); if (expected && expected.toLowerCase() !== checksum) throw new HealthConflict(); }
    if (!options.buffer || !request.healthUploadCapability || !request.healthUploadIdentity) throw new HealthDenied();
    const controller = new AbortController(); const aborted = () => controller.abort(); request.raw.once('aborted',aborted);
    const closed = () => { if (!reply.raw.writableFinished) controller.abort(); }; reply.raw.once('close',closed);
    const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]);
    try { const receipt = await options.buffer.accept(kind as HealthKind,request.healthUploadCapability,request.healthUploadIdentity,body,signal); return reply.code(202).send(receipt); }
    finally { request.raw.removeListener('aborted',aborted); reply.raw.removeListener('close',closed); }
  });
  return app;
}
