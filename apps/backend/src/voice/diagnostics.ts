import type { FastifyBaseLogger } from 'fastify';

export const voiceStages = new Set([
  'request_started', 'session_created', 'credential_loaded', 'settings_loaded',
  'away_mode_loaded', 'project_context_loaded', 'upstream_connecting', 'upstream_open',
  'session_update_sent', 'session_created_received', 'session_updated',
]);
export type VoiceStage = 'session_creation' | 'settings' | 'away_mode' | 'project_context' |
  'upstream_connecting' | 'upstream_ready';
export const voiceTimeoutStages = new Set<VoiceStage>([
  'session_creation', 'settings', 'away_mode', 'project_context', 'upstream_connecting', 'upstream_ready',
]);
export const voiceEventTypes = new Set([
  'error', 'session.created', 'session.updated', 'session.expired',
  'conversation.created', 'conversation.item.created', 'conversation.item.deleted',
  'conversation.item.truncated', 'conversation.item.input_audio_transcription.delta',
  'conversation.item.input_audio_transcription.completed', 'conversation.item.input_audio_transcription.failed',
  'input_audio_buffer.committed', 'input_audio_buffer.cleared',
  'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped',
  'response.created', 'response.done', 'response.cancelled',
  'response.output_item.added', 'response.output_item.done',
  'response.content_part.added', 'response.content_part.done',
  'response.text.delta', 'response.text.done', 'response.output_text.delta', 'response.output_text.done',
  'response.audio.delta', 'response.audio.done', 'response.output_audio.delta', 'response.output_audio.done',
  'response.audio_transcript.delta', 'response.audio_transcript.done',
  'response.output_audio_transcript.delta', 'response.output_audio_transcript.done',
  'response.function_call_arguments.delta', 'response.function_call_arguments.done',
  'rate_limits.updated', 'user.message',
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
  let update = { toolCount: 0, totalBytes: 0, largestTools: [] as { name: string; bytes: number }[] };
  let toolBudget: { toolBudgetRung: string | null; toolBudgetAttempts: number } | undefined;
  const measure = (message: unknown, serialized: string) => {
    const session = (message as { session?: { instructions?: unknown; tools?: { name?: unknown }[] } }).session;
    const tools = session?.tools ?? [];
    return {
      toolCount: tools.length, totalBytes: Buffer.byteLength(serialized),
      toolBytes: Buffer.byteLength(JSON.stringify(tools)),
      instructionsBytes: typeof session?.instructions === 'string' ? Buffer.byteLength(session.instructions) : 0,
      largestTools: tools.flatMap((tool) => typeof tool.name === 'string' &&
        /^[A-Za-z0-9_-]{1,64}$/u.test(tool.name)
        ? [{ name: tool.name, bytes: Buffer.byteLength(JSON.stringify(tool)) }] : [])
        .sort((left, right) => right.bytes - left.bytes).slice(0, 5),
    };
  };
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
    update(message: unknown, serialized: string) {
      if (update.totalBytes !== 0) return;
      const { toolCount, totalBytes, largestTools } = measure(message, serialized);
      update = { toolCount, totalBytes, largestTools };
    },
    /** Records one startup frame (the summary keeps the latest) and returns its content-free sizes. */
    attempt(message: unknown, serialized: string) {
      const { toolCount, totalBytes, largestTools, toolBytes, instructionsBytes } = measure(message, serialized);
      update = { toolCount, totalBytes, largestTools };
      return { toolCount, toolBytes, instructionsBytes, frameBytes: totalBytes };
    },
    measure(message: unknown, serialized: string) {
      const { toolCount, totalBytes, toolBytes, instructionsBytes } = measure(message, serialized);
      return { toolCount, toolBytes, instructionsBytes, frameBytes: totalBytes };
    },
    toolBudget(rung: string | null, attempts: number) { toolBudget = { toolBudgetRung: rung, toolBudgetAttempts: attempts }; },
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
        events: [...events], ...update, ...toolBudget,
      }, 'voice.session_summary');
    },
  };
}
