import { modelRoles } from '@jarvis/contracts';
import type { FastifyRequest } from 'fastify';
import {
  readSettings, settingsFieldsForCatalogue, settingsOptionsForCatalogue, settingsPatchRefusal,
  validateSettingsPatch, type SettingsPatch,
} from './settings.js';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

const getSettingsSchema = {
  type: 'object',
  properties: {
    area: { type: 'string', enum: ['roles', 'voice', 'research', 'memory', 'timeouts', 'appearance', 'personality'] },
  },
  additionalProperties: false,
} as const;

const updateSettingsSchema = {
  type: 'object',
  properties: {
    settings: { type: 'object', minProperties: 1 },
  },
  required: ['settings'],
  additionalProperties: false,
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function confirmationSummary(patch: SettingsPatch): string | null {
  const changes: string[] = [];
  for (const role of modelRoles) {
    if (patch.roles?.[role]) changes.push(`${role} model settings`);
  }
  if (patch.global?.visionDailyBudgetUsd !== undefined) changes.push('the daily vision budget');
  return changes.length ? `Change ${changes.join(' and ')} in Jarvis settings.` : null;
}

export async function applySettingsPatch(
  request: FastifyRequest,
  value: unknown,
  signal: AbortSignal,
) {
  const store = request.server.settingsStore;
  if (!store) throw new ToolRefusal('Settings are unavailable.');
  const catalogue = await request.server.modelCatalogue.read();
  const current = await readSettings(store, catalogue);
  const patch = validateSettingsPatch(value, catalogue, current);
  if (!patch) throw new ToolRefusal(settingsPatchRefusal(value, catalogue, current));

  const summary = confirmationSummary(patch);
  const save = async () => {
    signal.throwIfAborted();
    const latest = await readSettings(store, catalogue);
    const acceptedPatch = validateSettingsPatch(value, catalogue, latest);
    if (!acceptedPatch) throw new ToolRefusal(settingsPatchRefusal(value, catalogue, latest));
    const embeddingModelChanged = acceptedPatch.roles?.embedding?.model !== undefined &&
      acceptedPatch.roles.embedding.model !== latest.roles.embedding.model;
    await store.write(acceptedPatch);
    if (embeddingModelChanged) await request.server.onEmbeddingModelChanged?.(request.server.backgroundJobs);
    return readSettings(store, catalogue);
  };

  if (!summary) return save();
  const notifications = request.server.teamsNotifications;
  if (!notifications) throw new ToolRefusal('Now confirmation is unavailable; no settings were changed.');
  return notifications.runConfirmed('other', summary, save, signal);
}

export const getSettingsTool: JarvisTool = {
  name: 'get_settings',
  description: 'Read current non-secret settings, valid catalogue options and field constraints before updating. Optionally select an area. Credential values are never available.',
  inputSchema: getSettingsSchema,
  sensitive: true,
  async execute(input, request) {
    const store = request.server.settingsStore;
    if (!store) throw new ToolRefusal('Settings are unavailable.');
    const catalogue = await request.server.modelCatalogue.read();
    const settings = await readSettings(store, catalogue);
    const options = settingsOptionsForCatalogue(catalogue);
    const fields = settingsFieldsForCatalogue(catalogue, settings);
    const area = isObject(input) ? input.area : undefined;
    const optionKeys = {
      roles: ['roles', 'reasoningEfforts', 'jarvisModels', 'codexModels', 'codexReasoningEfforts', 'copilotModels', 'copilotReasoningEfforts'],
      voice: ['speechToTextModels', 'englishModels', 'englishVoices', 'danishVoices', 'languages', 'voiceTuning'],
      research: ['researchDepths', 'researchSettings'],
      memory: ['memorySettings'],
      timeouts: ['timeoutSettings'],
      appearance: ['themes', 'backgrounds', 'themeMotions', 'themeDensities'],
      personality: ['personalityTones', 'personalityResponseStyles'],
    } as const;
    if (area === undefined) return { settings, options, fields };
    if (typeof area !== 'string' || !Object.hasOwn(optionKeys, area)) {
      throw new ToolRefusal(`Invalid area. Valid values: ${Object.keys(optionKeys).join(', ')}.`);
    }
    const selectedArea = area as keyof typeof optionKeys;
    return {
      settings: { [selectedArea]: settings[selectedArea] },
      options: Object.fromEntries(optionKeys[selectedArea].map((key) => [key, options[key as keyof typeof options]])),
      fields: fields.filter((field) => field.path.startsWith(`${selectedArea}.`)),
    };
  },
};

export const updateSettingsTool: JarvisTool = {
  name: 'update_settings',
  description: 'Update supported non-secret Jarvis settings; read get_settings first when unsure of fields or values. Model-role and daily vision budget changes require Now confirmation.',
  inputSchema: updateSettingsSchema,
  sensitive: true,
  async execute(input, request, signal) {
    if (!isObject(input) || !isObject(input.settings) || Object.keys(input).some((key) => key !== 'settings')) {
      throw new ToolRefusal('Provide a settings object with supported keys and values.');
    }
    const settings = await applySettingsPatch(request, input.settings, signal);
    return { settings };
  },
};
