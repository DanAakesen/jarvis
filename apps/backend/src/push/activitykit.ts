import { connect, type ClientHttp2Session } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';
import { ConfigurationError } from '../config.js';

export type ActivityPhase = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';
export interface ActivityContentState {
  state: string;
  activity: null;
  phase: ActivityPhase;
}
export interface ActivityPushResult {
  accepted: boolean;
  invalidToken: boolean;
  retryable?: boolean;
}
export interface ActivityPushSender {
  send(token: string, content: ActivityContentState, signal: AbortSignal): Promise<ActivityPushResult>;
}
export interface ApnsConfig {
  teamId: string;
  keyId: string;
  signingKey: string;
  environment: 'sandbox' | 'production';
}
export type ActivityKitConfig = ApnsConfig;

export function loadApnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig {
  const { APNS_TEAM_ID: teamId, APNS_KEY_ID: keyId, APNS_SIGNING_KEY: signingKey, APNS_ENVIRONMENT: environment } = env;
  if (!teamId || !/^[A-Z0-9]{10}$/u.test(teamId) || !keyId || !/^[A-Z0-9]{10}$/u.test(keyId) ||
      !signingKey || signingKey.length > 4096 || !signingKey.startsWith('-----BEGIN PRIVATE KEY-----') ||
      (environment !== 'sandbox' && environment !== 'production')) {
    throw new ConfigurationError('APNs requires valid APNS_TEAM_ID, APNS_KEY_ID, APNS_SIGNING_KEY and explicit APNS_ENVIRONMENT');
  }
  return { teamId, keyId, signingKey, environment };
}

export function loadActivityKitConfig(env: NodeJS.ProcessEnv = process.env): ActivityKitConfig | undefined {
  const enabled = env.JARVIS_ACTIVITYKIT_ENABLED;
  if (enabled === undefined || enabled === 'false') return undefined;
  if (enabled !== 'true') throw new ConfigurationError('JARVIS_ACTIVITYKIT_ENABLED must be true or false');
  return loadApnsConfig(env);
}

export function activityPayload(content: ActivityContentState, now: number): Buffer {
  const timestamp = Math.floor(now / 1000);
  const terminal = ['done', 'failed', 'cancelled'].includes(content.phase);
  return Buffer.from(JSON.stringify({
    aps: {
      timestamp,
      event: terminal ? 'end' : 'update',
      'content-state': content,
      ...(terminal ? { 'dismissal-date': timestamp + 300 } : { 'stale-date': timestamp + 300 }),
    },
  }));
}

export async function createActivityPushSender(
  config: ActivityKitConfig,
  now: () => number = Date.now,
  open: typeof connect = connect,
): Promise<ActivityPushSender> {
  let key: Awaited<ReturnType<typeof importPKCS8>>;
  try {
    key = await importPKCS8(config.signingKey, 'ES256');
    await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).sign(key);
  }
  catch { throw new ConfigurationError('APNS_SIGNING_KEY must be an ES256 PKCS8 private key'); }
  let cached: { token: string; at: number } | undefined;
  const authority = config.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  return {
    async send(token, content, signal) {
      signal.throwIfAborted();
      if (!/^(?:[0-9a-f]{2}){32,256}$/u.test(token)) throw new TypeError('Invalid ActivityKit token');
      const at = now();
      if (!cached || at < cached.at || at - cached.at >= 50 * 60_000) {
        cached = {
          token: await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: config.keyId })
            .setIssuer(config.teamId).setIssuedAt(Math.floor(at / 1000)).sign(key),
          at,
        };
      }
      const payload = activityPayload(content, at);
      if (payload.length > 4096) throw new TypeError('ActivityKit payload exceeds limit');
      const authorization = `bearer ${cached.token}`;
      return new Promise<ActivityPushResult>((resolve, reject) => {
        let session: ClientHttp2Session | undefined;
        let settled = false;
        const finish = (result?: ActivityPushResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          session?.destroy();
          if (result) resolve(result);
          else reject(new Error('ActivityKit push transport unavailable'));
        };
        const abort = () => { finish(); };
        const timeout = setTimeout(abort, 5000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) return finish();
        try {
          session = open(authority);
          session.on('error', abort);
          session.on('close', () => { if (!settled) finish(); });
          const stream = session.request({
            ':method': 'POST',
            ':path': `/3/device/${token}`,
            authorization,
            'apns-topic': 'com.danaakesen.jarvis.push-type.liveactivity',
            'apns-push-type': 'liveactivity',
            'apns-priority': '5',
            'apns-expiration': '0',
            'content-type': 'application/json',
          });
          let status = 0;
          let length = 0;
          const chunks: Buffer[] = [];
          stream.on('response', (headers) => { status = Number(headers[':status']); });
          stream.on('error', abort);
          stream.on('aborted', abort);
          stream.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > 4096) finish();
            else chunks.push(chunk);
          });
          stream.on('end', () => {
            let reason: unknown;
            try { reason = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { reason?: unknown }).reason; }
            catch { /* A successful APNs response has no body. */ }
            finish({
              accepted: status === 200,
              invalidToken: status === 410 || status === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(String(reason)),
              ...(status === 429 || status >= 500 && status <= 599 ? { retryable: true } : {}),
            });
          });
          stream.end(payload);
        } catch { finish(); }
      });
    },
  };
}
