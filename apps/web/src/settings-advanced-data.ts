import {
  memorySettingsBounds, modelRoles, researchDepths, researchSettingsBounds, timeoutSettingsBounds, voiceTuningSettingsBounds,
  type MemorySettings, type ModelCatalogue, type ModelRole, type ReasoningEffort, type ResearchSettings, type TimeoutSettings,
  type VoiceTuningSettings,
} from '@jarvis/contracts';

/**
 * Settings for models per role, voice tuning, research, memory and retrieval, and timeouts (P9-13, #507). Roles are
 * the source of truth on the backend; when a backend sends them, they replace the older per-area model choices.
 */
export type RoleSettings = Record<ModelRole, { model: string; reasoningEffort: ReasoningEffort }>;
export interface RoleOptions { models: string[]; reasoningEffortsByModel: Record<string, string[]> }
export type { MemorySettings, ModelCatalogue, ModelRole, ResearchSettings, TimeoutSettings, VoiceTuningSettings };
export { modelRoles, researchDepths };

export const roleLabels: Record<ModelRole, { label: string; hint: string }> = {
  chat: { label: 'Chat', hint: 'Conversations and Danish voice' },
  vision: { label: 'Vision', hint: 'Screen, camera and images' },
  research: { label: 'Research', hint: 'Deep research jobs' },
  voice: { label: 'Voice', hint: 'English speech-to-speech' },
  transcription: { label: 'Transcription', hint: 'Speech to text' },
  embedding: { label: 'Embeddings', hint: 'Memory and knowledge search' },
  codex: { label: 'Codex', hint: 'Software Factory agent' },
  copilot: { label: 'Copilot', hint: 'Software Factory agent' },
};

export const effortLabels: Record<string, string> = {
  none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high',
};

export const capabilityLabels: Record<string, string> = {
  chat: 'Chat', responses: 'Responses', realtime: 'Realtime', transcription: 'Transcription', embeddings: 'Embeddings', image: 'Image',
};

export const bounds = {
  voice: voiceTuningSettingsBounds,
  research: researchSettingsBounds,
  memory: memorySettingsBounds,
  timeouts: timeoutSettingsBounds,
} as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const within = (value: unknown, range: { minimum: number; maximum: number }, integer = false) =>
  typeof value === 'number' && Number.isFinite(value) && value >= range.minimum && value <= range.maximum &&
  (!integer || Number.isInteger(value));

export function isRoleSettings(value: unknown): value is RoleSettings {
  return isObject(value) && modelRoles.every((role) => isObject(value[role]) &&
    typeof (value[role] as Record<string, unknown>).model === 'string' &&
    typeof (value[role] as Record<string, unknown>).reasoningEffort === 'string');
}

export function isRoleOptions(value: unknown): value is Record<ModelRole, RoleOptions> {
  return isObject(value) && modelRoles.every((role) => {
    const entry = value[role];
    return isObject(entry) && Array.isArray(entry.models) && entry.models.every((model) => typeof model === 'string') &&
      isObject(entry.reasoningEffortsByModel);
  });
}

/** Problems with the advanced values, keyed by `area.key`, so fields can explain them and Save can wait. */
export function advancedProblems(settings: {
  voice: Partial<VoiceTuningSettings>; research?: ResearchSettings; memory?: MemorySettings; timeouts?: TimeoutSettings;
}): Record<string, string> {
  const problems: Record<string, string> = {};
  const check = (key: string, value: unknown, range: { minimum: number; maximum: number }, integer = false) => {
    if (value !== undefined && !within(value, range, integer)) problems[key] = `Use ${range.minimum}–${range.maximum}${integer ? ' (whole number)' : ''}.`;
  };
  check('voice.serverVadThreshold', settings.voice.serverVadThreshold, bounds.voice.serverVadThreshold);
  check('voice.prefixPaddingMs', settings.voice.prefixPaddingMs, bounds.voice.prefixPaddingMs, true);
  check('voice.silenceDurationMs', settings.voice.silenceDurationMs, bounds.voice.silenceDurationMs, true);
  check('voice.maxSpokenReplyTokens', settings.voice.maxSpokenReplyTokens, bounds.voice.maxSpokenReplyTokens, true);
  if (settings.research) {
    check('research.maxSources', settings.research.maxSources, bounds.research.maxSources, true);
    check('research.timeoutSeconds', settings.research.timeoutSeconds, bounds.research.timeoutSeconds, true);
  }
  if (settings.memory) {
    check('memory.similarityThreshold', settings.memory.similarityThreshold, bounds.memory.similarityThreshold);
    check('memory.searchTopK', settings.memory.searchTopK, bounds.memory.searchTopK, true);
    check('memory.graphTextSimilarityThreshold', settings.memory.graphTextSimilarityThreshold, bounds.memory.graphTextSimilarityThreshold);
  }
  if (settings.timeouts) {
    check('timeouts.toolTimeoutSeconds', settings.timeouts.toolTimeoutSeconds, bounds.timeouts.toolTimeoutSeconds, true);
    check('timeouts.longToolTimeoutSeconds', settings.timeouts.longToolTimeoutSeconds, bounds.timeouts.longToolTimeoutSeconds, true);
    check('timeouts.backendHttpTimeoutSeconds', settings.timeouts.backendHttpTimeoutSeconds, bounds.timeouts.backendHttpTimeoutSeconds, true);
  }
  return problems;
}

/** Reasoning levels the chosen model supports; a model without reasoning offers only None. */
export function effortsFor(options: Record<ModelRole, RoleOptions>, role: ModelRole, model: string): string[] {
  const efforts = options[role]?.reasoningEffortsByModel[model];
  return Array.isArray(efforts) && efforts.length ? efforts : ['none'];
}
