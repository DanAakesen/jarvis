import { defaultAwayModeState, presenceModes } from './away-mode.js';
import { JARVIS_REPOSITORY, projectContext } from '../factory/project-context.js';

export interface Settings {
  appearance: {
    theme: 'light' | 'dark' | 'system';
    accent?: string;
    'accent-secondary'?: string;
    'surface-tint'?: string;
    background?: 'living-aurora' | 'daylight-studio';
    glow?: number;
    motion?: 'full' | 'calm' | 'reduced';
    radius?: number;
    density?: 'compact' | 'comfortable';
  };
  jarvis: {
    model: string;
    reasoning: string;
  };
  personality: {
    tone: 'british_butler' | 'warm' | 'direct' | 'playful';
    responseStyle: 'concise' | 'balanced' | 'detailed';
    customInstructions: string;
    modeInstructions: Record<'present' | 'away' | 'on_the_move', string>;
  };
  voice: {
    speechToTextModel: string;
    englishModel: string;
    englishVoice: string;
    danishVoice: string;
    defaultLanguage: 'da' | 'en';
    minimizeWindowsOnVoiceStart: boolean;
  };
  codex: {
    model: string;
    reasoning: string;
  };
  copilot: {
    model: string;
  };
  global: {
    maxParallelTasks: number;
    maxCheckAttempts: number;
    screenShareDailyFrameCap: number;
    visionDailyBudgetUsd: number;
  };
  newProjects: {
    owner: string;
    visibility: 'private' | 'public';
    templatesRepository: string;
    defaultAgent: 'codex' | 'copilot';
    policy: 'deliver_pr' | 'complete_without_deployment';
    maxParallelTasks: number;
    defaultBranch: string;
  };
}

export type SettingsPatch = {
  [Area in keyof Settings]?: Area extends 'personality'
    ? Omit<Partial<Settings[Area]>, 'modeInstructions'> & {
      modeInstructions?: Partial<Settings['personality']['modeInstructions']>;
    }
    : Partial<Settings[Area]>;
};

export interface SettingsStore {
  read(): Promise<Record<string, unknown>>;
  write(settings: SettingsPatch): Promise<void>;
}

export const defaultSettings: Settings = {
  appearance: { theme: 'light' },
  jarvis: { model: 'gpt-5.6-luna', reasoning: 'none' },
  personality: {
    tone: 'british_butler',
    responseStyle: 'concise',
    customInstructions: '',
    modeInstructions: { present: '', away: '', on_the_move: '' },
  },
  voice: {
    speechToTextModel: 'mai-transcribe',
    englishModel: 'gpt-realtime-2.1',
    englishVoice: 'en-GB-Ryan:DragonHDLatestNeural',
    danishVoice: 'da-DK-Harper:MAI-Voice-2',
    defaultLanguage: 'da',
    minimizeWindowsOnVoiceStart: false,
  },
  codex: { model: 'default', reasoning: 'default' },
  copilot: { model: 'default' },
  global: { maxParallelTasks: 1, maxCheckAttempts: 3, screenShareDailyFrameCap: 300, visionDailyBudgetUsd: 1 },
  newProjects: {
    owner: 'DanAakesen',
    visibility: 'private',
    templatesRepository: 'DanAakesen/templates',
    defaultAgent: 'copilot',
    policy: 'deliver_pr',
    maxParallelTasks: 1,
    defaultBranch: 'main',
  },
};

export const settingsOptions = {
  themes: ['light', 'dark', 'system'],
  backgrounds: ['living-aurora', 'daylight-studio'],
  themeMotions: ['full', 'calm', 'reduced'],
  themeDensities: ['compact', 'comfortable'],
  jarvisModels: ['gpt-5.6-luna'],
  reasoningEfforts: ['none', 'low', 'medium', 'high'],
  personalityTones: ['british_butler', 'warm', 'direct', 'playful'],
  personalityResponseStyles: ['concise', 'balanced', 'detailed'],
  speechToTextModels: ['mai-transcribe'],
  englishModels: ['gpt-realtime-2.1'],
  englishVoices: ['en-GB-Ryan:DragonHDLatestNeural'],
  danishVoices: ['da-DK-Harper:MAI-Voice-2'],
  languages: ['da', 'en'],
  codexModels: ['default'],
  codexReasoningEfforts: ['default'],
  copilotModels: ['default'],
  projectVisibilities: ['private', 'public'],
  projectAgents: ['codex', 'copilot'],
  projectPolicies: ['deliver_pr', 'complete_without_deployment'],
} as const;

const settingKeys = {
  appearance: {
    theme: 'appearance.theme',
    accent: 'appearance.accent',
    'accent-secondary': 'appearance.accent-secondary',
    'surface-tint': 'appearance.surface-tint',
    background: 'appearance.background',
    glow: 'appearance.glow',
    motion: 'appearance.motion',
    radius: 'appearance.radius',
    density: 'appearance.density',
  },
  jarvis: { model: 'jarvis.model', reasoning: 'jarvis.reasoning_effort' },
  personality: {
    tone: 'personality.tone',
    responseStyle: 'personality.response_style',
    customInstructions: 'personality.custom_instructions',
    modeInstructions: {
      present: 'personality.modeInstructions.present',
      away: 'personality.modeInstructions.away',
      on_the_move: 'personality.modeInstructions.on_the_move',
    },
  },
  voice: {
    speechToTextModel: 'voice.stt.model',
    englishModel: 'voice.en.model',
    englishVoice: 'voice.en.voice',
    danishVoice: 'voice.da.voice',
    defaultLanguage: 'voice.default_language',
    minimizeWindowsOnVoiceStart: 'voice.minimize_windows_on_voice_start',
  },
  codex: { model: 'codex.model', reasoning: 'codex.reasoning_effort' },
  copilot: { model: 'copilot.model' },
  global: {
    maxParallelTasks: 'global.max_parallel_tasks',
    maxCheckAttempts: 'global.max_check_attempts',
    screenShareDailyFrameCap: 'global.screen_share_daily_frame_cap',
    visionDailyBudgetUsd: 'global.vision_daily_budget_usd',
  },
  newProjects: {
    owner: 'new_projects.owner',
    visibility: 'new_projects.visibility',
    templatesRepository: 'new_projects.templates_repository',
    defaultAgent: 'new_projects.default_agent',
    policy: 'new_projects.policy',
    maxParallelTasks: 'new_projects.max_parallel_tasks',
    defaultBranch: 'new_projects.default_branch',
  },
} as const;

export const settingsStoreKeys = Object.freeze(
  Object.values(settingKeys).flatMap((area) =>
    Object.values(area).flatMap((key) => typeof key === 'string' ? [key] : Object.values(key))),
);

function isOption(value: unknown, options: readonly string[]): value is string {
  return typeof value === 'string' && options.includes(value);
}

function validInstruction(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2_000 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 && character !== '\n' && character !== '\r' && character !== '\t';
    });
}

function validSetting(area: keyof Settings, key: string, value: unknown): boolean {
  if (area === 'appearance') {
    if (key === 'theme') return isOption(value, settingsOptions.themes);
    if (key === 'accent' || key === 'accent-secondary' || key === 'surface-tint') {
      return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
    }
    if (key === 'background') return isOption(value, settingsOptions.backgrounds);
    if (key === 'glow') {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    }
    if (key === 'motion') return isOption(value, settingsOptions.themeMotions);
    if (key === 'radius') {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24;
    }
    if (key === 'density') return isOption(value, settingsOptions.themeDensities);
  }
  if (area === 'jarvis') {
    if (key === 'model') return isOption(value, settingsOptions.jarvisModels);
    if (key === 'reasoning') return isOption(value, settingsOptions.reasoningEfforts);
  }
  if (area === 'personality') {
    if (key === 'tone') return isOption(value, settingsOptions.personalityTones);
    if (key === 'responseStyle') return isOption(value, settingsOptions.personalityResponseStyles);
    if (key === 'customInstructions') return validInstruction(value);
    if (key === 'modeInstructions') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const instructions = value as Record<string, unknown>;
      return Object.keys(instructions).length > 0 &&
        Object.entries(instructions).every(([mode, instruction]) =>
          ['present', 'away', 'on_the_move'].includes(mode) && validInstruction(instruction));
    }
  }
  if (area === 'voice') {
    if (key === 'speechToTextModel') return isOption(value, settingsOptions.speechToTextModels);
    if (key === 'englishModel') return isOption(value, settingsOptions.englishModels);
    if (key === 'englishVoice') return isOption(value, settingsOptions.englishVoices);
    if (key === 'danishVoice') return isOption(value, settingsOptions.danishVoices);
    if (key === 'defaultLanguage') return isOption(value, settingsOptions.languages);
    if (key === 'minimizeWindowsOnVoiceStart') return typeof value === 'boolean';
  }
  if (area === 'codex') {
    if (key === 'model') return isOption(value, settingsOptions.codexModels);
    if (key === 'reasoning') return isOption(value, settingsOptions.codexReasoningEfforts);
  }
  if (area === 'copilot' && key === 'model') return isOption(value, settingsOptions.copilotModels);
  if (area === 'global' && key === 'maxParallelTasks') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 100;
  }
  if (area === 'global' && key === 'maxCheckAttempts') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10;
  }
  if (area === 'global' && key === 'screenShareDailyFrameCap') {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 300;
  }
  if (area === 'global' && key === 'visionDailyBudgetUsd') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
  }
  if (area === 'newProjects') {
    if (key === 'owner') {
      return typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
    }
    if (key === 'visibility') return isOption(value, settingsOptions.projectVisibilities);
    if (key === 'templatesRepository') {
      return typeof value === 'string' &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/.test(value);
    }
    if (key === 'defaultAgent') return isOption(value, settingsOptions.projectAgents);
    if (key === 'policy') return isOption(value, settingsOptions.projectPolicies);
    if (key === 'maxParallelTasks') {
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 100;
    }
    if (key === 'defaultBranch') {
      return typeof value === 'string' && value.length > 0 && value.length <= 255 &&
        [...value].every((character) => character.charCodeAt(0) > 0x20) &&
        !/[~^:?*\\[\]]/.test(value) && !value.includes('..') && !value.includes('@{') &&
        value !== '@' && !value.startsWith('-') && !value.startsWith('/') && !value.endsWith('/') &&
        !value.includes('//') && !value.endsWith('.') &&
        !value.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'));
    }
  }
  return false;
}

const selectSchema = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const settingsPatchSchema = {
  type: 'object',
  required: ['settings'],
  additionalProperties: true,
  properties: {
    settings: {
      type: 'object',
      minProperties: 1,
      additionalProperties: true,
      properties: {
        appearance: {
          type: 'object', minProperties: 1, additionalProperties: true,
          properties: {
            theme: selectSchema(settingsOptions.themes),
            accent: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', maxLength: 7 },
            'accent-secondary': { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', maxLength: 7 },
            'surface-tint': { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', maxLength: 7 },
            background: selectSchema(settingsOptions.backgrounds),
            glow: { type: 'number', minimum: 0, maximum: 1 },
            motion: selectSchema(settingsOptions.themeMotions),
            radius: { type: 'number', minimum: 0, maximum: 24 },
            density: selectSchema(settingsOptions.themeDensities),
          },
        },
        jarvis: {
          type: 'object', minProperties: 1, additionalProperties: true,
          properties: {
            model: selectSchema(settingsOptions.jarvisModels),
            reasoning: selectSchema(settingsOptions.reasoningEfforts),
          },
        },
        personality: {
          type: 'object', minProperties: 1, additionalProperties: true,
          properties: {
            tone: selectSchema(settingsOptions.personalityTones),
            responseStyle: selectSchema(settingsOptions.personalityResponseStyles),
            customInstructions: { type: 'string', maxLength: 2_000 },
            modeInstructions: {
              type: 'object',
              minProperties: 1,
              additionalProperties: false,
              properties: {
                present: { type: 'string', maxLength: 2_000 },
                away: { type: 'string', maxLength: 2_000 },
                on_the_move: { type: 'string', maxLength: 2_000 },
              },
            },
          },
        },
        voice: {
          type: 'object', minProperties: 1, additionalProperties: true,
          properties: {
            speechToTextModel: selectSchema(settingsOptions.speechToTextModels),
            englishModel: selectSchema(settingsOptions.englishModels),
            englishVoice: selectSchema(settingsOptions.englishVoices),
            danishVoice: selectSchema(settingsOptions.danishVoices),
            defaultLanguage: selectSchema(settingsOptions.languages),
            minimizeWindowsOnVoiceStart: { type: 'boolean' },
          },
        },
        codex: {
          type: 'object', minProperties: 1, additionalProperties: true,
          properties: {
            model: selectSchema(settingsOptions.codexModels),
            reasoning: selectSchema(settingsOptions.codexReasoningEfforts),
          },
        },
        copilot: {
          type: 'object', minProperties: 1, additionalProperties: true,
          properties: { model: selectSchema(settingsOptions.copilotModels) },
        },
        global: {
          type: 'object', minProperties: 1, additionalProperties: true,
          properties: {
            maxParallelTasks: { type: 'integer', minimum: 1, maximum: 100 },
            maxCheckAttempts: { type: 'integer', minimum: 0, maximum: 10 },
            screenShareDailyFrameCap: { type: 'integer', minimum: 1, maximum: 300 },
            visionDailyBudgetUsd: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
        newProjects: {
          type: 'object', minProperties: 1, additionalProperties: true,
          properties: {
            owner: { type: 'string', minLength: 1, maxLength: 39 },
            visibility: selectSchema(settingsOptions.projectVisibilities),
            templatesRepository: { type: 'string', minLength: 3, maxLength: 140 },
            defaultAgent: selectSchema(settingsOptions.projectAgents),
            policy: selectSchema(settingsOptions.projectPolicies),
            maxParallelTasks: { type: 'integer', minimum: 1, maximum: 100 },
            defaultBranch: { type: 'string', minLength: 1, maxLength: 255 },
          },
        },
      },
    },
  },
};

function isSettingsPatch(value: unknown): value is SettingsPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const areas = Object.keys(value);
  if (areas.length === 0) return false;
  for (const area of areas) {
    if (!Object.hasOwn(settingKeys, area)) return false;
    const values = (value as Record<string, unknown>)[area];
    if (typeof values !== 'object' || values === null || Array.isArray(values)) return false;
    const keys = Object.keys(values);
    if (keys.length === 0) return false;
    for (const key of keys) {
      if (!Object.hasOwn(settingKeys[area as keyof Settings], key)) return false;
      const setting = (values as Record<string, unknown>)[key];
      if (!validSetting(area as keyof Settings, key, setting)) return false;
    }
  }
  return true;
}

function mergeSettings(stored: Partial<Settings>): Settings {
  const merged = structuredClone(defaultSettings);
  for (const area of Object.keys(settingKeys) as (keyof Settings)[]) {
    const values = stored[area];
    if (!values || typeof values !== 'object') continue;
    for (const key of Object.keys(settingKeys[area]) as (keyof Settings[typeof area])[]) {
      const value = (values as Record<string, unknown>)[key];
      if (validSetting(area, key, value)) {
        if (area === 'personality' && key === 'modeInstructions') {
          Object.assign(merged.personality.modeInstructions, value);
        } else {
          (merged[area] as Record<string, unknown>)[key] = value;
        }
      }
    }
  }
  return merged;
}

function parseStoredValues(values: Record<string, unknown>): Partial<Settings> {
  const stored: Record<string, Record<string, unknown>> = {};
  for (const area of Object.keys(settingKeys) as (keyof Settings)[]) {
    for (const [key, storeKey] of Object.entries(settingKeys[area])) {
      if (typeof storeKey === 'string') {
        const persisted = values[storeKey];
        if (persisted === undefined) continue;
        let value: unknown;
        try { value = JSON.parse(String(persisted)); } catch { continue; }
        if (validSetting(area, key, value)) (stored[area] ??= {})[key] = value;
      } else {
        const instructions: Record<string, string> = {};
        for (const [mode, nestedStoreKey] of Object.entries(storeKey as Record<string, string>)) {
          const persisted = values[nestedStoreKey];
          if (persisted === undefined) continue;
          let value: unknown;
          try { value = JSON.parse(String(persisted)); } catch { continue; }
          if (validInstruction(value)) instructions[mode] = value;
        }
        if (Object.keys(instructions).length > 0) {
          (stored[area] ??= {})[key] = instructions;
        }
      }
    }
  }
  return stored as Partial<Settings>;
}

function flattenedKey(area: keyof Settings, key: string, nestedKey?: string): string {
  const mapping = settingKeys[area][key as keyof Settings[typeof area]];
  if (typeof mapping === 'string') return mapping;
  if (!nestedKey || !Object.hasOwn(mapping, nestedKey)) throw new TypeError('Invalid settings key');
  return mapping[nestedKey];
}

export async function readSettings(settingsStore: SettingsStore): Promise<Settings> {
  return mergeSettings(parseStoredValues(await settingsStore.read()));
}

function flattenSettings(settings: SettingsPatch): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  for (const area of Object.keys(settings) as (keyof Settings)[]) {
    const values = settings[area];
    if (!values) continue;
    for (const key of Object.keys(values) as (keyof Settings[typeof area])[]) {
      const value = values[key];
      if (value === undefined) continue;
      if (area === 'personality' && key === 'modeInstructions') {
        for (const [mode, instruction] of Object.entries(value)) {
          entries.push({ key: flattenedKey(area, key, mode), value: JSON.stringify(instruction) });
        }
      } else {
        entries.push({ key: flattenedKey(area, key as string), value: JSON.stringify(value) });
      }
    }
  }
  return entries;
}

export async function registerSettingsRoutes(app: import('fastify').FastifyInstance) {
  app.post<{ Params: { name: string } }>('/settings/credentials/:name/renew', async (request, reply) => {
    if (request.principal?.objectId !== app.ownerObjectId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (request.params.name !== 'codex-login') {
      return reply.code(400).send({ error: 'Credential cannot be renewed here' });
    }
    if (!app.credentialStatusStore || !app.renewCodexCredential) {
      return reply.code(503).send({ error: 'Credential renewal unavailable' });
    }
    try {
      const outcome = await app.renewCodexCredential();
      const credential = (await app.credentialStatusStore.list()).find((row) => row.name === 'codex-login');
      if (!credential) return reply.code(503).send({ error: 'Credential status unavailable' });
      if (outcome === 'skipped') {
        return reply.code(409).send({ error: 'Codex credential is busy; retry later', credential });
      }
      if (outcome === 'uncertain') {
        return reply.code(503).send({ error: 'Renewal outcome uncertain; retry later', credential });
      }
      if (outcome === 'failed') {
        return reply.code(502).send({ error: 'Credential renewal failed', credential });
      }
      return { credential };
    } catch {
      request.log.warn('credentials.codex_renewal_failed');
      return reply.code(503).send({ error: 'Credential renewal unavailable' });
    }
  });

  app.get('/settings', async (_request, reply) => {
    if (!app.settingsStore) return reply.code(503).send({ error: 'Settings unavailable' });
    const credentials = await app.credentialStatusStore?.list() ?? [];
    return {
      settings: await readSettings(app.settingsStore),
      options: settingsOptions,
      credentials,
    };
  });

  app.get('/agent/settings', {
    config: { jarvisAgent: true },
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            model: { type: 'string' },
            reasoningEffort: { type: 'string' },
            personality: {
              type: 'object',
              properties: {
                tone: selectSchema(settingsOptions.personalityTones),
                responseStyle: selectSchema(settingsOptions.personalityResponseStyles),
                customInstructions: { type: 'string', maxLength: 2_000 },
                modeInstructions: {
                  type: 'object',
                  properties: {
                    present: { type: 'string', maxLength: 2_000 },
                    away: { type: 'string', maxLength: 2_000 },
                    on_the_move: { type: 'string', maxLength: 2_000 },
                  },
                  required: ['present', 'away', 'on_the_move'],
                  additionalProperties: false,
                },
              },
              required: ['tone', 'responseStyle', 'customInstructions', 'modeInstructions'],
              additionalProperties: false,
            },
            awayMode: { type: 'boolean' },
            mode: { type: 'string', enum: [...presenceModes] },
            changedAt: { type: ['string', 'null'] },
            jarvisRepository: { type: 'string' },
            projects: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, name: { type: 'string' }, repo: { type: 'string' } },
                required: ['id', 'name', 'repo'],
                additionalProperties: false,
              },
            },
          },
          required: ['model', 'reasoningEffort', 'personality', 'awayMode', 'mode', 'changedAt'],
          additionalProperties: false,
        },
        403: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
        503: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
      },
    },
  }, async (request, reply) => {
    if (!request.agentPrincipal) return reply.code(403).send({ error: 'Forbidden' });
    if (!app.settingsStore) return reply.code(503).send({ error: 'Settings unavailable' });
    const settings = await readSettings(app.settingsStore);
    const presence = await app.awayModeStore?.read() ?? defaultAwayModeState;
    return {
      model: settings.jarvis.model,
      reasoningEffort: settings.jarvis.reasoning,
      personality: settings.personality,
      awayMode: presence.mode !== 'present',
      mode: presence.mode,
      changedAt: presence.changedAt,
      jarvisRepository: JARVIS_REPOSITORY,
      projects: await projectContext(app),
    };
  });

  app.patch('/settings', {
    schema: { body: settingsPatchSchema },
    preValidation: async (request, reply) => {
      const budget = (request.body as {
        settings?: { global?: { visionDailyBudgetUsd?: unknown } };
      } | undefined)?.settings?.global?.visionDailyBudgetUsd;
      // AJV would otherwise coerce null to zero, unintentionally disabling watch.
      if (budget !== undefined && typeof budget !== 'number') {
        return reply.code(400).send({ error: 'Invalid setting value' });
      }
    },
  }, async (request, reply) => {
    if (!app.settingsStore) return reply.code(503).send({ error: 'Settings unavailable' });
    const body = request.body as { settings: unknown };
    if (!isSettingsPatch(body.settings)) return reply.code(400).send({ error: 'Invalid setting value' });
    const patch = body.settings;
    await app.settingsStore.write(patch);
    const credentials = await app.credentialStatusStore?.list() ?? [];
    return {
      settings: await readSettings(app.settingsStore),
      options: settingsOptions,
      credentials,
    };
  });
}

export { flattenSettings };
