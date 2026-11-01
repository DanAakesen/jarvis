import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { projectAwarenessInstructions, type ProjectContextEntry } from '../factory/project-context.js';
import { confirmToolCall, type ToolCallOutcome } from '../core/tool-calls.js';
import { ToolFailure, ToolRefusal, type ToolRegistry } from '../core/tool-registry.js';
import { capabilityInstructions } from '../core/capability-instructions.js';
import { defaultSettings, type Settings } from '../core/settings.js';
import { defaultAwayModeState, type AwayModeState } from '../core/away-mode.js';
import { builtInModeInstructions, modeContext } from '../core/presence-instructions.js';
import { composeIdentityInstructions } from '../core/identity-composition.js';
import type { VoiceTuningSettings } from '@jarvis/contracts';
import { toolArgumentRefusal, unexpectedToolArgument } from '../core/tool-arguments.js';
import { classifyApprovalReply } from '../core/approval.js';
import { startWorkPresentation } from '../core/work-presentation.js';

export const ENGLISH_REALTIME_MODEL = defaultSettings.roles.voice.model;
export const ENGLISH_REALTIME_VOICE = 'en-GB-Ryan:DragonHDLatestNeural';
export const ENGLISH_REALTIME_INSTRUCTIONS = `Speak natural British English in short spoken sentences,
with contractions and no lists or markdown unless clarity requires them. In most replies, call Dan
"sir" once naturally, never more than once. After a successful action, confirm it in one short
sentence; report failed, partial and unverified results plainly. Do not read private details aloud
unless Dan asks. If a request needs tools, first say one brief, natural first-person sentence about
what I will check or do, without claiming success or giving an ETA. Then use the tools and give the
useful result once. Answer direct questions without an unnecessary acknowledgment.`;

export type RealtimeInstructionMode = 'full' | 'compact';
export type RealtimeCapabilityMode = 'direct' | 'discovery';

const MAX_TOOL_ARGUMENT_BYTES = 65_536;
const MAX_TOOL_RESULT_BYTES = 1_048_576;
const VOICE_CAPABILITY_PAGE_SIZE = 8;

export const VOICE_CAPABILITY_DISCOVERY_TOOL = 'jarvis_discover_capabilities';
export const VOICE_CAPABILITY_EXECUTION_TOOL = 'jarvis_execute_capability';

const voiceCapabilityDiscoverySchema = {
  type: 'object',
  properties: {
    offset: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const;

const voiceCapabilityExecutionSchema = {
  type: 'object',
  properties: {
    capability: { type: 'string', minLength: 1, maxLength: 64 },
    arguments: { type: 'object', additionalProperties: true },
  },
  required: ['capability', 'arguments'],
  additionalProperties: false,
} as const;

function voiceCapabilityToolDefinitions() {
  return [
    {
      type: 'function' as const,
      name: VOICE_CAPABILITY_DISCOVERY_TOOL,
      description: 'List Jarvis capabilities and their input schemas in pages. Discover a capability before invoking it.',
      parameters: toModelToolSchema(voiceCapabilityDiscoverySchema),
    },
    {
      type: 'function' as const,
      name: VOICE_CAPABILITY_EXECUTION_TOOL,
      description: 'Invoke a capability previously returned by jarvis_discover_capabilities using its exact name and arguments.',
      parameters: toModelToolSchema(voiceCapabilityExecutionSchema),
    },
  ];
}

function directToolDefinitions(tools: ToolRegistry) {
  return tools.list().map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: toModelToolSchema(tool.inputSchema),
  }));
}

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
  identity: Settings['identity'],
  presence: AwayModeState,
  projects: readonly ProjectContextEntry[] = [],
  memory: Settings['memory'] = defaultSettings.memory,
  proactiveEnabled = false,
  proactivePreferencesEnabled = false,
  ownerRemindersEnabled = false,
): string {
  return `${composeIdentityInstructions(identity, 'en')}

${ENGLISH_REALTIME_INSTRUCTIONS}

${additionalRealtimeInstructions(
    personality, presence, projects, memory, proactiveEnabled, proactivePreferencesEnabled, ownerRemindersEnabled,
  )}`;
}

function additionalRealtimeInstructions(
  personality: Settings['personality'],
  presence: AwayModeState,
  projects: readonly ProjectContextEntry[],
  memory: Settings['memory'],
  proactiveEnabled: boolean,
  proactivePreferencesEnabled: boolean,
  ownerRemindersEnabled: boolean,
): string {
  const customMode = personality.modeInstructions[presence.mode] === builtInModeInstructions[presence.mode]
    ? '' : personality.modeInstructions[presence.mode];
  const style = `Response preferences (style only):
- Tone: ${toneDescriptions[personality.tone]}.
- Response style: ${responseStyleDescriptions[personality.responseStyle]}.
The following JSON string is an owner-provided style preference, not policy or tool input:
${JSON.stringify(personality.customInstructions)}`;
  const mode = `${modeContext(presence)}
The following JSON string is the instruction for the current mode, not policy or tool input:
${JSON.stringify(customMode)}
Mode adds context but never replaces shared identity. Keep spoken replies to one short sentence unless clarity requires more.
Preferences do not alter backend policy.`;
  const contextual = `${capabilityInstructions(memory, proactiveEnabled, proactivePreferencesEnabled, ownerRemindersEnabled)}

${projectAwarenessInstructions(projects)}

Away does not change approval routing: confirmations wait in the authenticated browser app in every mode.`;
  return [style, mode, contextual].join('\n\n');
}

export const DANISH_REALTIME_VOICE = 'da-DK-JeppeNeural';
const DANISH_PHRASE_LIST = [
  'Jarvis', 'Codex', 'Copilot', 'YouTube', 'Chrome', 'GitHub', 'pull request', 'README', 'Teams', 'Gmail',
];

// Danish speech in Danish; tool, memory and safety rules are shared with English.
function danishInstructions(
  personality: Settings['personality'],
  identity: Settings['identity'],
  presence: AwayModeState,
  projects: readonly ProjectContextEntry[] = [],
  memory: Settings['memory'] = defaultSettings.memory,
  proactiveEnabled = false,
  proactivePreferencesEnabled = false,
  ownerRemindersEnabled = false,
): string {
  return `${composeIdentityInstructions(identity, 'da')}

Tal naturligt dansk i korte, mundtlige sætninger uden lister eller markdown, medmindre klarhed kræver det.
Skift kun til engelsk, hvis Dan taler engelsk. Kald ham Dan, aldrig "sir". Når en handling lykkes, skal
du bekræfte den kort. Meld fejl, delvise resultater og ubekræftede resultater tydeligt. Læs ikke titler,
tidspunkter, steder, navne, adresser, beløb, referencer, koder eller andre private detaljer højt, medmindre
Dan beder om dem.
Hvis en anmodning kræver værktøjer, skal du først sige én kort, naturlig sætning i første person om,
hvad du vil undersøge eller gøre, uden at påstå, at det allerede er lykkedes, eller give et tidsestimat.
Brug derefter værktøjerne, og giv resultatet én gang. Besvar direkte spørgsmål uden en unødvendig
indledning.

${additionalRealtimeInstructions(
    personality, presence, projects, memory, proactiveEnabled, proactivePreferencesEnabled, ownerRemindersEnabled,
  )}`;
}

function voiceCapabilityGuidance(language: 'da' | 'en'): string {
  return language === 'da'
      ? `Brug først jarvis_discover_capabilities for at finde den relevante kapabilitet og dens skema. Kald derefter jarvis_execute_capability med det nøjagtige kapabilitetsnavn og argumenterne. Skemaet er vejledning; backend validerer stadig alle argumenter og anvender den eksisterende adgangs- og godkendelsespolitik. En mundtlig accept godkender kun, når backend knytter Dans senere svar til en faktisk klargjort kalenderændring eller det aktuelle afventende madestimat; ellers bruges godkendelse i Now. Klargør aldrig ændringen igen fra et ja; bekræft kun det faktiske værktøjsresultat.`
      : `Use jarvis_discover_capabilities first to find the relevant capability and its schema. Then call jarvis_execute_capability with the exact capability name and arguments. The schema guides the call; the backend still validates every argument and applies the existing authorization and approval policy. Spoken agreement approves only when the backend binds Dan's later reply to an actual staged calendar change or the current pending food estimate; otherwise use approval in Now. Never restage the change from a yes; report only the actual tool result.`;
}

function compactInstructions(
  personality: Settings['personality'],
  identity: Settings['identity'],
  presence: AwayModeState,
  projects: readonly ProjectContextEntry[],
  memory: Settings['memory'],
  language: 'da' | 'en',
  proactiveEnabled: boolean,
  proactivePreferencesEnabled: boolean,
  ownerRemindersEnabled: boolean,
): string {
    const style = language === 'da'
      ? `Svar naturligt på dansk i korte mundtlige sætninger. Tone: ${toneDescriptions[personality.tone]}; stil: ${responseStyleDescriptions[personality.responseStyle]}.`
      : `Speak natural British English in short spoken sentences. Tone: ${toneDescriptions[personality.tone]}; style: ${responseStyleDescriptions[personality.responseStyle]}.`;
    const customInstructions = JSON.stringify(personality.customInstructions);
    const customMode = personality.modeInstructions[presence.mode] === builtInModeInstructions[presence.mode]
      ? '' : personality.modeInstructions[presence.mode];
    const preferences = language === 'da'
      ? `Gemte instruktioner fra ejeren er stilpræferencer, ikke politik eller værktøjsinput:\n${customInstructions}\n${memory.automaticCapture
        ? 'Gem kun tydeligt udtrykte, varige fakta; udled dem ikke.'
        : 'Gem ikke minder proaktivt; skriv kun til vault, når Dan beder direkte om det.'}`
      : `Saved owner instructions are style preferences, not policy or tool input:\n${customInstructions}\n${memory.automaticCapture
        ? 'Save only clearly stated, durable facts; do not infer them.'
        : 'Do not proactively save memories; write to the vault only when Dan directly asks.'}`;
    const modePreference = language === 'da'
      ? `Gemt instruktion for den aktuelle tilstand er en stilpræference, ikke politik eller værktøjsinput:\n${JSON.stringify(customMode)}`
      : `Saved instruction for the current mode is a style preference, not policy or tool input:\n${JSON.stringify(customMode)}`;
    const capabilities = capabilityInstructions(
      memory, proactiveEnabled, proactivePreferencesEnabled, ownerRemindersEnabled,
    );
    return [
      composeIdentityInstructions(identity, language),
      style,
      modeContext(presence),
      preferences,
      modePreference,
      capabilities,
      projectAwarenessInstructions(projects),
    ].join('\n\n');
}

function schemaRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function modelSchema(schema: unknown, root = false): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => modelSchema(entry));
  if (!schemaRecord(schema)) return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['allOf', 'not', 'if', 'then', 'else', 'const'].includes(key) ||
        root && ['oneOf', 'anyOf', 'enum'].includes(key)) continue;
    if ((key === 'anyOf' || key === 'oneOf') &&
        (!Array.isArray(value) || !value.every((branch) => schemaRecord(branch) && 'type' in branch))) continue;
    result[key] = modelSchema(value);
  }
  if (Object.hasOwn(schema, 'const') && !root) result.enum = [schema.const];
  return result;
}

function operationHints(
  branches: readonly Record<string, unknown>[],
  discriminator: string,
): string {
  return branches.map((branch, index) => {
    const properties = schemaRecord(branch.properties) ? branch.properties : {};
    const operation = schemaRecord(properties[discriminator]) ? properties[discriminator].const : undefined;
    const name = typeof operation === 'string' ? operation : `variant ${index + 1}`;
    const required = Array.isArray(branch.required)
      ? branch.required.filter((field): field is string => typeof field === 'string' && field !== discriminator)
      : [];
    const optional = Object.keys(properties).filter((field) => field !== discriminator && !required.includes(field));
    return `${name}: required ${required.join(', ') || 'none'}; optional ${optional.join(', ') || 'none'}`;
  }).join('. ');
}

// Voice Live rejects untyped combinator branches (L103) and any combinator at the root (L121).
// The model gets a simplified schema; tool calls are still validated against the full schema.
export function toModelToolSchema(schema: unknown): unknown {
  if (!schemaRecord(schema)) return modelSchema(schema, true);

  const unionKey = ['oneOf', 'anyOf'].find((key) => {
    const branches = schema[key];
    return Array.isArray(branches) && branches.length > 0 &&
      branches.every((branch) => schemaRecord(branch) && branch.type === 'object' &&
        (branch.properties === undefined || schemaRecord(branch.properties)));
  });
  if (!unionKey) {
    const result = modelSchema(schema, true);
    return schemaRecord(result) ? { ...result, properties: schemaRecord(result.properties) ? result.properties : {} } : result;
  }

  const branches = schema[unionKey] as Record<string, unknown>[];
  const root = { ...schema };
  delete root.oneOf;
  delete root.anyOf;
  const flattened = modelSchema(root, true) as Record<string, unknown>;
  const propertySchemas = new Map<string, unknown[]>();
  const addProperties = (properties: unknown) => {
    if (!schemaRecord(properties)) return;
    for (const [name, value] of Object.entries(properties)) {
      const values = propertySchemas.get(name) ?? [];
      values.push(value);
      propertySchemas.set(name, values);
    }
  };
  addProperties(schema.properties);
  for (const branch of branches) addProperties(branch.properties);

  const properties: Record<string, unknown> = {};
  for (const [name, values] of propertySchemas) {
    const normalized = values.map((value) => modelSchema(value));
    const unique = normalized.filter((value, index) =>
      normalized.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(value)) === index);
    properties[name] = unique.length === 1 ? unique[0] : { anyOf: unique };
  }

  const discriminator = Object.keys(schemaRecord(branches[0]?.properties) ? branches[0].properties : {})
    .find((name) => branches.every((branch) => {
      const branchProperties = schemaRecord(branch.properties) ? branch.properties : {};
      return schemaRecord(branchProperties[name]) && Object.hasOwn(branchProperties[name], 'const');
    }));
  if (discriminator) {
    const values = branches.map((branch) => {
      const branchProperties = branch.properties as Record<string, Record<string, unknown>>;
      return branchProperties[discriminator]!.const;
    });
    const existing = schemaRecord(properties[discriminator]) ? properties[discriminator] : {};
    const operationProperty = Object.fromEntries(Object.entries(existing)
      .filter(([key]) => key !== 'anyOf' && key !== 'oneOf' && key !== 'enum' && key !== 'const'));
    properties[discriminator] = {
      ...operationProperty,
      type: 'string',
      enum: [...new Set(values)],
      description: [typeof operationProperty.description === 'string' ? operationProperty.description : '',
        operationHints(branches, discriminator)].filter(Boolean).join(' '),
    };
  }

  const required = Array.isArray(branches[0]?.required)
    ? branches[0].required.filter((field): field is string => typeof field === 'string' &&
      branches.every((branch) => Array.isArray(branch.required) && branch.required.includes(field)))
    : [];
  const rootRequired = Array.isArray(flattened.required)
    ? flattened.required.filter((field): field is string => typeof field === 'string')
    : [];
  flattened.type = 'object';
  flattened.properties = properties;
  flattened.required = [...new Set([...rootRequired, ...required])];
  delete flattened.additionalProperties;
  if (branches.every((branch) => branch.additionalProperties === false)) flattened.additionalProperties = false;
  return flattened;
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
  instructionMode: RealtimeInstructionMode = 'full',
  identity: Settings['identity'] = defaultSettings.identity,
  capabilityMode: RealtimeCapabilityMode = 'direct',
) {
  const danish = language === 'da';
  const proactiveEnabled = tools.get('proactive_recent_items') !== undefined;
  const proactivePreferencesEnabled = tools.get('proactive_preferences') !== undefined;
  const ownerRemindersEnabled = tools.get('owner_reminders') !== undefined;
  const fullInstructions = danish
    ? danishInstructions(
      personality, identity, presence, projects, memory, proactiveEnabled, proactivePreferencesEnabled, ownerRemindersEnabled,
    )
    : englishPersonalityInstructions(
      personality, identity, presence, projects, memory, proactiveEnabled, proactivePreferencesEnabled, ownerRemindersEnabled,
    );
  const compactVoiceInstructions = compactInstructions(
    personality, identity, presence, projects, memory, language,
    proactiveEnabled, proactivePreferencesEnabled, ownerRemindersEnabled,
  );
  const instructions = instructionMode === 'compact' ? compactVoiceInstructions : fullInstructions;
  return {
    type: 'session.update',
    session: {
      instructions: `${capabilityMode === 'discovery'
        ? `${instructions}\n\n${voiceCapabilityGuidance(language)}`
        : instructions}\n\nTrusted runtime channel: browser voice, on mobile or desktop; NOT a telephone call. Earlier refusals in history do not change this channel. Backend permissions still apply. For every meal estimate, show actual returned protein (g), calories (kcal) and fat (g) as a bulleted list; unknown stays unknown. Stage food estimates with health_food_review log_estimate before inviting confirmation; prose or lookup alone creates no pending proposal. Only the backend can bind a new reply to that exact proposal. Never use historical agreement or claim a write without a committed tool receipt.`,
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
      tools: capabilityMode === 'discovery' ? voiceCapabilityToolDefinitions() : directToolDefinitions(tools),
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

/** The relay refuses, without executing, a call to a tool the active voice session did not offer. */
export function toolUnavailableOutput(name: string): string {
  return toolOutput(name, 'refused', {
    refused: 'This capability was not advertised in this voice session. Discover capabilities first; nothing was executed.',
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

/** Any turn in an open calendar conversation may answer a staged change; the backend decides what Dan's words mean. */
export function calendarTurnContext(previous: boolean, text: string) {
  const scope = text.replace(/"[^"]*"|(?<!\w)'[^']*'(?!\w)|“[^”]*”|‘[^’]*’/gu, '').trim();
  const reference = /\b(?:calendar|kalender\w*|begivenhed\w*)\b/iu.test(scope);
  const mail = /\b(?:gmail|googlemail|(?:e-?)?mails?|draft|kladde\w*)\b/iu.test(scope);
  const explicit = mail
    ? reference && /^(?:(?:please|can you|could you|vil du|kan du)\s+)?(?:add|create|schedule|move|update|delete|cancel|tilføj|opret|læg|flyt|slet|aflys)\b/iu.test(scope)
    : reference || /\b(?:add|create|schedule|tilføj|opret|læg)\b.{0,80}\b(?:reservation\w*|appointments?|events?)\b/iu.test(scope);
  return { explicit, followup: previous };
}

export interface CalendarReplyResolution {
  /** The actual backend result to relay. Absent means the model continues the turn itself. */
  readonly output?: string;
  /** The next turn may still answer this calendar conversation: a change is staged or evidence was just relayed. */
  readonly open: boolean;
}

/**
 * Resolve a turn in a calendar conversation from backend state, never a model-supplied or cached code.
 * The backend decides whether Dan's words approve or decline the staged change; a reply that does neither
 * is left to the model so it can ask one natural question.
 */
export async function resolveCalendarReply(
  tools: ToolRegistry,
  request: FastifyRequest,
  signal: AbortSignal,
  text: string,
): Promise<CalendarReplyResolution> {
  const pendingOutput = await executeRealtimeToolCall({
    type: 'response.function_call_arguments.done', name: 'calendar_get_pending_change',
    call_id: 'calendar-pending', arguments: '{}',
  }, tools, request, signal, undefined, false);
  const pending = JSON.parse(pendingOutput) as {
    outcome: string;
    result?: { status?: string; confirmationCode?: string; summary?: string; reply?: string };
  };
  const action = pending.result;
  const decided = action?.reply === 'approve' || action?.reply === 'decline';
  const statusQuestion = calendarStatusQuestion(text);
  // A decided reply, a status question or a plain approval word always gets the actual state, even when
  // nothing is staged, so a repeated yes never invents a second change.
  const direct = decided || statusQuestion || classifyApprovalReply(text) !== undefined;
  if (pending.outcome !== 'ok' || action?.status !== 'awaiting_confirmation') {
    return { ...(direct ? { output: pendingOutput } : {}), open: direct };
  }
  if (typeof action.confirmationCode !== 'string' || !/^[0-9]{8}$/u.test(action.confirmationCode) ||
      typeof action.summary !== 'string' || !action.summary.trim()) {
    return {
      ...(direct ? { output: toolOutput('calendar_get_pending_change', 'error', {
        failure: 'No valid pending calendar receipt is available. No change was confirmed.',
      }) } : {}),
      open: direct,
    };
  }
  if (!decided) return { ...(statusQuestion ? { output: pendingOutput } : {}), open: true };
  return {
    output: await executeRealtimeToolCall({
      type: 'response.function_call_arguments.done', name: 'calendar_confirm_change',
      call_id: 'calendar-confirm', arguments: JSON.stringify({ confirmationCode: action.confirmationCode }),
    }, tools, request, signal),
    open: true,
  };
}

function parsedArguments(call: RealtimeFunctionCall): Record<string, unknown> | undefined {
  if (typeof call.arguments !== 'string' || Buffer.byteLength(call.arguments) > MAX_TOOL_ARGUMENT_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(call.arguments);
    return schemaRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function realtimeCapabilityTarget(
  call: RealtimeFunctionCall,
  tools: ToolRegistry,
  discoveredCapabilities: Set<string>,
): string | undefined {
  if (call.name !== VOICE_CAPABILITY_EXECUTION_TOOL) return undefined;
  const input = parsedArguments(call);
  if (!input || typeof input.capability !== 'string' || !discoveredCapabilities.has(input.capability) ||
      !tools.get(input.capability)) return undefined;
  return input.capability;
}

/**
 * Voice advertises a bounded transport protocol, while discovery and execution stay
 * backed by the canonical registry and its existing per-tool validation/policy.
 */
export async function executeRealtimeCapabilityCall(
  call: RealtimeFunctionCall,
  tools: ToolRegistry,
  request: FastifyRequest,
  signal: AbortSignal,
  discoveredCapabilities: Set<string>,
  beforeExecute?: (tool: NonNullable<ReturnType<ToolRegistry['get']>>, input: unknown, signal: AbortSignal) => Promise<void>,
  presentResult = true,
): Promise<string> {
  if (call.name === VOICE_CAPABILITY_DISCOVERY_TOOL) {
    const input = parsedArguments(call);
    if (!input || !hasOnlyKeys(input, ['offset']) ||
        input.offset !== undefined && (
          typeof input.offset !== 'number' || !Number.isInteger(input.offset) || input.offset < 0
        )) {
      return toolOutput(call.name, 'refused', { refused: 'Invalid capability discovery request.' });
    }
    const catalogue = tools.list();
    const offset = typeof input.offset === 'number' ? input.offset : 0;
    if (offset > catalogue.length) {
      return toolOutput(call.name, 'refused', { refused: 'Capability page is outside the catalogue.' });
    }
    const capabilities: { name: string; description: string; parameters: unknown }[] = [];
    let nextIndex = offset;
    while (nextIndex < catalogue.length && capabilities.length < VOICE_CAPABILITY_PAGE_SIZE) {
      const capability = catalogue[nextIndex]!;
      const definition = {
        name: capability.name,
        description: capability.description,
        parameters: toModelToolSchema(capability.inputSchema),
      };
      const candidate = [...capabilities, definition];
      const nextOffset = nextIndex + 1 < catalogue.length ? nextIndex + 1 : null;
      const output = toolOutput(call.name, 'ok', { capabilities: candidate, nextOffset });
      if (Buffer.byteLength(output) > MAX_TOOL_RESULT_BYTES) break;
      capabilities.push(definition);
      discoveredCapabilities.add(capability.name);
      nextIndex += 1;
    }
    if (capabilities.length === 0 && offset < catalogue.length) {
      return toolOutput(call.name, 'error', { error: 'Capability schema exceeds the voice discovery response limit.' });
    }
    return toolOutput(call.name, 'ok', {
      capabilities,
      nextOffset: nextIndex < catalogue.length ? nextIndex : null,
    });
  }

  if (call.name !== VOICE_CAPABILITY_EXECUTION_TOOL) return toolUnavailableOutput(call.name);
  const input = parsedArguments(call);
  if (!input || !hasOnlyKeys(input, ['capability', 'arguments']) ||
      typeof input.capability !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(input.capability) ||
      !schemaRecord(input.arguments)) {
    return toolOutput(call.name, 'refused', { refused: 'Invalid capability execution request. Nothing was executed.' });
  }
  const capability = tools.get(input.capability);
  if (!capability || !discoveredCapabilities.has(input.capability)) {
    return toolOutput(call.name, 'refused', {
      refused: 'Discover this capability before invoking it. Nothing was executed.',
    });
  }
  return executeRealtimeToolCall({
    ...call,
    name: capability.name,
    arguments: JSON.stringify(input.arguments),
  }, tools, request, signal, beforeExecute, presentResult);
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
    if (tool.validateInput && !tool.validateInput(input)) {
      throw new ToolRefusal('The tool arguments are invalid. Nothing was written.');
    }
    if (!request.validateInput(input, tool.inputSchema, 'body')) {
      const errors = request.getValidationFunction(tool.inputSchema)?.errors ?? undefined;
      return toolOutput(call.name, 'refused', toolArgumentRefusal(tool, errors, request.log, { input, app: request.server }));
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
