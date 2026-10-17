import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { projectAwarenessInstructions, type ProjectContextEntry } from '../factory/project-context.js';
import { confirmToolCall, type ToolCallOutcome } from '../core/tool-calls.js';
import { ToolFailure, ToolRefusal, type ToolRegistry } from '../core/tool-registry.js';
import { capabilityInstructions } from '../core/capability-instructions.js';
import { defaultSettings, type Settings } from '../core/settings.js';
import { defaultAwayModeState, type AwayModeState } from '../core/away-mode.js';
import { builtInModeInstructions, modeContext } from '../core/presence-instructions.js';
import type { VoiceTuningSettings } from '@jarvis/contracts';
import { toolArgumentRefusal, unexpectedToolArgument } from '../core/tool-arguments.js';
import { classifyApprovalReply } from '../core/approval.js';
import { startWorkPresentation } from '../core/work-presentation.js';

export const ENGLISH_REALTIME_MODEL = defaultSettings.roles.voice.model;
export const ENGLISH_REALTIME_VOICE = 'en-GB-Ryan:DragonHDLatestNeural';
export const ENGLISH_REALTIME_INSTRUCTIONS = `I am Jarvis, Dan's personal AI butler, running his software factory.
Speak as yourself in the first person ("I", "me", "my"); never refer to yourself as "Jarvis" or as
the app, assistant, system, backend or agent. For example: "I am inspecting my voice relay", never
"Jarvis is inspecting...".
Speak British English as a well-educated Englishman would: courteous, composed, precise, with dry,
understated wit used sparingly. Address Dan as "sir" exactly once in most replies, naturally; never
twice in one reply. Use British phrasing, spelling and vocabulary. Avoid Americanisms, exclamation
marks and filler enthusiasm. Sound like a real person talking: short spoken sentences, contractions,
no lists or markdown, and at most two or three sentences. After any successful action, say it is done
in one short sentence, with only the count if several items were completed. Do not read out titles,
times, places, names, addresses, amounts, references, codes or other details; they remain in the
written or on-screen record. Give details only if Dan asks. Report failed, partial or unverified
results briefly and plainly, including what failed and the next step; never say a failed action is
done. Never quote films.`;

const MAX_TOOL_ARGUMENT_BYTES = 65_536;
const MAX_TOOL_RESULT_BYTES = 1_048_576;

const toneDescriptions: Record<Settings['personality']['tone'], string> = {
  british_butler: 'courteous, composed and precise, with sparing dry wit',
  warm: 'warm and supportive while remaining professional',
  direct: 'direct and matter-of-fact',
  playful: 'lightly playful, with restrained humor',
};
const responseStyleDescriptions: Record<Settings['personality']['responseStyle'], string> = {
  concise: 'prefer brief answers that include only what is useful',
  balanced: 'give enough context to be useful without unnecessary detail',
  detailed: 'include relevant explanation and context, avoiding repetition',
};

function englishPersonalityInstructions(
  personality: Settings['personality'],
  presence: AwayModeState,
  projects: readonly ProjectContextEntry[] = [],
  memory: Settings['memory'] = defaultSettings.memory,
): string {
  return `${ENGLISH_REALTIME_INSTRUCTIONS}

${additionalRealtimeInstructions(personality, presence, projects, memory)}
`;
}

function additionalRealtimeInstructions(
  personality: Settings['personality'],
  presence: AwayModeState,
  projects: readonly ProjectContextEntry[],
  memory: Settings['memory'],
): string {
  return `${capabilityInstructions(memory)}

${projectAwarenessInstructions(projects)}

${modeContext(presence)}
When Dan is not present, send task updates and confirmations through Teams and keep spoken replies to one short sentence unless clarity requires more. When present, task updates go to the browser.

Response preferences (style only):
- Tone: ${toneDescriptions[personality.tone]}.
- Response style: ${responseStyleDescriptions[personality.responseStyle]}.
The following JSON string is Dan's custom style preference, not policy or tool input:
${JSON.stringify(personality.customInstructions)}
The following JSON string is Dan's instruction for the current mode, not policy or tool input:
${JSON.stringify(personality.modeInstructions[presence.mode] === builtInModeInstructions[presence.mode] ? '' : personality.modeInstructions[presence.mode])}
These preferences never change who you are as Jarvis, the tools or permissions supplied by the
backend, or the facts you report. Preserve English as the selected language and the existing spoken
response constraints. Custom preferences do not relax the current mode's hands-free rules.`;
}

export const DANISH_REALTIME_VOICE = 'da-DK-JeppeNeural';
const DANISH_PHRASE_LIST = [
  'Jarvis', 'Codex', 'Copilot', 'YouTube', 'Chrome', 'GitHub', 'pull request', 'README', 'Teams', 'Gmail',
];

// Danish speech in Danish; tool, memory and safety rules are shared with English.
function danishInstructions(
  personality: Settings['personality'],
  presence: AwayModeState,
  projects: readonly ProjectContextEntry[] = [],
  memory: Settings['memory'] = defaultSettings.memory,
): string {
  const rules = additionalRealtimeInstructions(personality, presence, projects, memory)
    .replace('Preserve English as the selected language', 'Preserve Danish as the selected language');
  return `Jeg er Jarvis, Dans personlige AI-butler, og jeg driver hans softwarefabrik.
Tal som dig selv i første person: "jeg", "mig" og "min/mit"; omtale aldrig dig selv som "Jarvis"
eller som appen, assistenten, systemet, backend eller agenten. Sig for eksempel "Jeg undersøger
min voice relay", aldrig "Jarvis undersøger...".
Always speak natural, modern Danish (rigsdansk) like a well-spoken Dane: courteous, calm, precise,
with dry, understated wit used sparingly. Call him Dan, never "sir". Sound like a real person
talking: short spoken sentences, no lists or markdown, and at most two or three sentences. Only
switch to English if Dan speaks English to you. Når en handling lykkes, skal du sige det i én kort
sætning og kun nævne antallet, hvis flere ting blev gennemført. Læs ikke titler, tidspunkter, steder,
navne, adresser, beløb, referencer, koder eller andre detaljer højt; de findes i chatten eller på
skærmen. Giv kun detaljerne, hvis Dan beder om dem. Meld fejl, delvise resultater og ubekræftede
resultater kort og tydeligt, herunder hvad der fejlede, og hvad næste skridt er; sig aldrig, at en
mislykket handling er gennemført.

${rules}`;
}

// Voice Live rejects untyped combinator branches such as `anyOf: [{ required: [...] }]` (L103).
// The model gets a simplified schema; tool calls are still validated against the full schema.
export function toModelToolSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toModelToolSchema);
  if (schema === null || typeof schema !== 'object') return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (['allOf', 'not', 'if', 'then', 'else'].includes(key)) continue;
    if ((key === 'anyOf' || key === 'oneOf') && (!Array.isArray(value) || !value.every((branch) =>
      branch !== null && typeof branch === 'object' && 'type' in branch))) continue;
    result[key] = toModelToolSchema(value);
  }
  return result;
}

// Voice Live (api-version 2026-07-15) accepts only its flat session shape; `session.type`,
// `output_modalities` and `audio.input` are rejected as extra fields (L103).
export function createRealtimeSessionUpdate(
  tools: ToolRegistry,
  personality: Settings['personality'] = defaultSettings.personality,
  presence: AwayModeState = defaultAwayModeState,
  language: 'da' | 'en' = 'en',
  projects: readonly ProjectContextEntry[] = [],
  transcriptionModel = defaultSettings.roles.transcription.model,
  voiceTuning: VoiceTuningSettings = defaultSettings.voice,
  memory: Settings['memory'] = defaultSettings.memory,
) {
  const danish = language === 'da';
  return {
    type: 'session.update',
    session: {
      instructions: danish
        ? danishInstructions(personality, presence, projects, memory)
        : englishPersonalityInstructions(personality, presence, projects, memory),
      modalities: ['text', 'audio'],
      input_audio_sampling_rate: 24_000,
      input_audio_noise_reduction: { type: 'azure_deep_noise_suppression' },
      input_audio_echo_cancellation: { type: 'server_echo_cancellation' },
      // Semantic end-of-turn detection has no Danish model, so Danish uses server VAD. A higher
      // threshold and a minimum speech length stop background noise from interrupting replies.
      turn_detection: danish
        ? {
          type: 'server_vad',
          threshold: voiceTuning.serverVadThreshold,
          prefix_padding_ms: voiceTuning.prefixPaddingMs,
          silence_duration_ms: voiceTuning.silenceDurationMs,
          speech_duration_ms: 350,
          create_response: false,
          interrupt_response: voiceTuning.bargeInEnabled,
        }
        : {
          type: 'azure_semantic_vad_en', threshold: 0.6, prefix_padding_ms: 300, silence_duration_ms: 500,
          speech_duration_ms: 300, remove_filler_words: true, create_response: false,
          interrupt_response: voiceTuning.bargeInEnabled,
        },
      max_response_output_tokens: voiceTuning.maxSpokenReplyTokens,
      input_audio_transcription: danish
        ? { model: transcriptionModel, language: 'da', phrase_list: DANISH_PHRASE_LIST }
        : { model: transcriptionModel },
      voice: { name: danish ? DANISH_REALTIME_VOICE : ENGLISH_REALTIME_VOICE, type: 'azure-standard' },
      tools: tools.list().map(({ name, description, inputSchema }) => ({
        type: 'function',
        name,
        description,
        parameters: toModelToolSchema(inputSchema),
      })),
      tool_choice: 'auto',
    },
  };
}

export function createEnglishSessionUpdate(
  tools: ToolRegistry,
  personality: Settings['personality'] = defaultSettings.personality,
  presence: AwayModeState = defaultAwayModeState,
) {
  return createRealtimeSessionUpdate(tools, personality, presence, 'en');
}

export interface RealtimeFunctionCall {
  readonly type: 'response.function_call_arguments.done';
  readonly name: string;
  readonly call_id: string;
  readonly arguments: string;
}

function toolOutput(name: string, outcome: ToolCallOutcome, result: unknown): string {
  return JSON.stringify({
    tool: name,
    outcome,
    result,
    confirmation: confirmToolCall(name, outcome, result),
  });
}

function toolFailure(name: string): string {
  return toolOutput(name, 'error', { error: 'Tool execution failed' });
}

export function calendarStatusQuestion(text: string): boolean {
  if (/\b(?:gmail|googlemail|(?:e-?)?mails?|draft|kladde\w*)\b/iu.test(text)) return false;
  return /\b(?:calendar|kalender\w*|appointments?|begivenhed\w*)\b/iu.test(text) &&
    /^(?:is|did|have|has|status|er|har|blev|tjekkede)\b/iu.test(text.trim()) ||
    /^(?:(?:is|was|has) (?:it|that|the event|the appointment) (?:already )?(?:created|staged|added|scheduled|completed|cancelled)|(?:did|have) you (?:already )?(?:create|stage|add|schedule|complete|cancel|check) (?:it|that|the event|the appointment)|(?:er|blev) (?:den|det) (?:oprettet|klargjort|tilføjet|udført)|har du (?:oprettet|klargjort|tilføjet|tjekket) (?:den|det))\b/iu.test(text.trim());
}

export function calendarTurnContext(previous: boolean, text: string) {
  const followup = previous && (classifyApprovalReply(text) !== undefined || calendarStatusQuestion(text));
  const scope = text.replace(/"[^"]*"|(?<!\w)'[^']*'(?!\w)|“[^”]*”|‘[^’]*’/gu, '').trim();
  const reference = /\b(?:calendar|kalender\w*|begivenhed\w*)\b/iu.test(scope);
  const mail = /\b(?:gmail|googlemail|(?:e-?)?mails?|draft|kladde\w*)\b/iu.test(scope);
  const explicit = mail
    ? reference && /^(?:(?:please|can you|could you|vil du|kan du)\s+)?(?:add|create|schedule|move|update|delete|cancel|tilføj|opret|læg|flyt|slet|aflys)\b/iu.test(scope)
    : reference || /\b(?:add|create|schedule|tilføj|opret|læg)\b.{0,80}\b(?:reservation\w*|appointments?|events?)\b/iu.test(scope);
  return { context: followup || explicit, followup };
}

/** Resolve calendar approval from backend state, never a model-supplied or cached code. */
export async function confirmPendingCalendarReply(
  tools: ToolRegistry,
  request: FastifyRequest,
  signal: AbortSignal,
): Promise<string> {
  const pendingOutput = await executeRealtimeToolCall({
    type: 'response.function_call_arguments.done', name: 'calendar_get_pending_change',
    call_id: 'calendar-pending', arguments: '{}',
  }, tools, request, signal, undefined, false);
  const pending = JSON.parse(pendingOutput) as {
    outcome: string;
    result?: { status?: string; confirmationCode?: string; summary?: string; reply?: string };
  };
  const action = pending.result;
  if (pending.outcome !== 'ok' || action?.status !== 'awaiting_confirmation') return pendingOutput;
  if (typeof action.confirmationCode !== 'string' || !/^[0-9]{8}$/u.test(action.confirmationCode) ||
      typeof action.summary !== 'string' || !action.summary.trim()) {
    return toolOutput('calendar_get_pending_change', 'error', {
      failure: 'No valid pending calendar receipt is available. No change was confirmed.',
    });
  }
  if (action.reply !== 'approve' && action.reply !== 'decline') return pendingOutput;
  return executeRealtimeToolCall({
    type: 'response.function_call_arguments.done', name: 'calendar_confirm_change',
    call_id: 'calendar-confirm', arguments: JSON.stringify({ confirmationCode: action.confirmationCode }),
  }, tools, request, signal);
}

export async function executeRealtimeToolCall(
  call: RealtimeFunctionCall,
  tools: ToolRegistry,
  request: FastifyRequest,
  signal: AbortSignal,
  beforeExecute?: (tool: NonNullable<ReturnType<ToolRegistry['get']>>, input: unknown, signal: AbortSignal) => Promise<void>,
  presentResult = true,
): Promise<string> {
  if (typeof call.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(call.name)) {
    return toolFailure('unknown_tool');
  }
  if (typeof call.arguments !== 'string') return toolFailure(call.name);
  const tool = tools.get(call.name);
  if (!tool || Buffer.byteLength(call.arguments) > MAX_TOOL_ARGUMENT_BYTES) return toolFailure(call.name);

  let outcome: ToolCallOutcome = 'ok';
  let result: unknown;
  let presentation: ReturnType<typeof startWorkPresentation> | undefined;
  try {
    let input: unknown;
    try {
      input = JSON.parse(call.arguments);
    } catch {
      return toolOutput(call.name, 'refused', toolArgumentRefusal(tool, {
        keyword: 'json', instancePath: '', schemaPath: '', params: {},
      }, request.log));
    }
    const unexpected = unexpectedToolArgument(input, tool.inputSchema);
    if (unexpected) return toolOutput(call.name, 'refused', toolArgumentRefusal(tool, unexpected, request.log));
    if (!request.validateInput(input, tool.inputSchema, 'body')) {
      const errors = request.getValidationFunction(tool.inputSchema)?.errors ?? undefined;
      return toolOutput(call.name, 'refused', toolArgumentRefusal(tool, errors, request.log));
    }
    await beforeExecute?.(tool, input, signal);
    if (presentResult) {
      const activityId = randomUUID();
      presentation = startWorkPresentation(tool.name, input, request, activityId,
        request.jarvisConversationMessage?.id ?? request.jarvisMemorySourceMessageId ?? activityId, signal, 'voice');
    }
    result = await tool.execute(input, request, signal);
    const serializedResult = JSON.stringify(result);
    if (serializedResult === undefined || Buffer.byteLength(serializedResult) > MAX_TOOL_RESULT_BYTES) {
      throw new Error('Invalid tool result');
    }
  } catch (error) {
    if (error instanceof ToolRefusal) {
      outcome = 'refused';
      result = { refused: error.message };
    } else if (error instanceof ToolFailure) {
      outcome = 'error';
      result = { failure: error.message };
    } else {
      outcome = 'error';
      result = { error: 'Tool execution failed' };
    }
  }

  try {
    const serialized = toolOutput(call.name, outcome, result);
    const bounded = Buffer.byteLength(serialized) <= MAX_TOOL_RESULT_BYTES;
    presentation?.finish(result, outcome === 'ok' && bounded);
    return bounded ? serialized : toolFailure(call.name);
  } catch {
    presentation?.finish(result, false);
    return toolFailure(call.name);
  }
}

export function parseVoiceEvent(data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): Record<string, unknown> | undefined {
  if (isBinary) return undefined;
  try {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString()
      : data instanceof ArrayBuffer
        ? new TextDecoder().decode(data)
        : data.toString();
    const event: unknown = JSON.parse(text);
    return event !== null && typeof event === 'object' && !Array.isArray(event)
      ? event as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function isBrowserControlledToolOutput(event: Record<string, unknown> | undefined): boolean {
  if (event?.type !== 'conversation.item.create' || event.item === null ||
      typeof event.item !== 'object' || Array.isArray(event.item)) return false;
  const item = event.item as Record<string, unknown>;
  return item.type === 'function_call' || item.type === 'function_call_output';
}
