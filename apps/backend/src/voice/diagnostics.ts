import type { FastifyBaseLogger } from 'fastify';

export const voiceStages = new Set([
  'request_started', 'session_created', 'proactive_context_loaded', 'proactive_context_unavailable',
  'credential_loaded', 'credential_unavailable', 'upstream_connecting', 'upstream_open',
  'session_started',
]);
export type VoiceStage = 'session_creation' | 'proactive_context' | 'credential' | 'upstream_connecting' | 'upstream_ready';
export const voiceTimeoutStages = new Set<VoiceStage>([
  'session_creation', 'proactive_context', 'credential', 'upstream_connecting', 'upstream_ready',
]);
export const voiceEventTypes = new Set([
  'error', 'session.start', 'session.started', 'session.closed', 'session.usage.updated',
  'session.input_audio.muted', 'session.input_audio.unmuted',
  'session.input_transcript.delta', 'session.output_transcript.delta',
  'session.output_audio.delta', 'session.delegation.created',
  'session.commentary.appended',
]);

export const VOICE_STARTUP_CLOSE_CODE = 4010;

export class VoiceStageTimeout extends Error {
  constructor() { super('Voice startup stage timed out'); }
}

/** One owner for startup deadlines and the terminal, content-free diagnostic record. */
export function createVoiceDiagnostics(
  log: FastifyBaseLogger, language: 'en' | 'da', signal: AbortSignal, startedAt: number,
) {
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  const stages: { stage: string; elapsedMs: number }[] = [];
  const events = new Set<string>();
  let summaryLogged = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let endReason: 'inactivity' | 'max_duration' | undefined;
  const stage = (name: string) => {
    if (summaryLogged || stages.some((entry) => entry.stage === name)) return;
    stages.push({ stage: name, elapsedMs: elapsed() });
    log.info({ language, stage: name, elapsedMs: elapsed() }, 'voice.session_stage');
  };
  const timeout = (name: VoiceStage, timeoutMs: number) => log.warn({
    language, stage: name, lastStage: stages.at(-1)?.stage, elapsedMs: elapsed(), timeoutMs,
  }, 'voice.stage_timeout');
  const clearWatchdog = () => { clearTimeout(watchdog); watchdog = undefined; };
  signal.addEventListener('abort', clearWatchdog, { once: true });
  stage('request_started');
  return {
    stage,
    event(type: unknown) {
      if (typeof type === 'string' && voiceEventTypes.has(type)) events.add(type);
    },
    endReason(reason: 'inactivity' | 'max_duration') { endReason = reason; },
    watchdog(name: 'upstream_connecting' | 'upstream_ready', fail: () => void) {
      clearWatchdog();
      watchdog = setTimeout(() => { timeout(name, 15_000); fail(); }, 15_000);
      watchdog.unref();
    },
    clearWatchdog,
    async bound<T>(name: VoiceStage, milliseconds: number, work: () => Promise<T>): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: () => void = () => {};
      try {
        signal.throwIfAborted();
        return await Promise.race([
          work(),
          new Promise<never>((_resolve, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => {
              timeout(name, milliseconds);
              reject(new VoiceStageTimeout());
            }, milliseconds);
            timer.unref();
          }),
        ]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    },
    summary(closedBy: 'browser' | 'upstream' | 'relay' | 'shutdown', closeCode: number) {
      if (summaryLogged) return;
      summaryLogged = true;
      clearWatchdog();
      signal.removeEventListener('abort', clearWatchdog);
      log.info({
        language, closedBy, closeCode, durationMs: elapsed(), stages,
        events: [...events], ...(endReason ? { endReason } : {}),
      }, 'voice.session_summary');
    },
  };
}
