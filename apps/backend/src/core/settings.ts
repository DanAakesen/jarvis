export interface Settings {
  jarvis: {
    model: string;
    reasoning: string;
  };
  personality: {
    tone: 'british_butler' | 'warm' | 'direct' | 'playful';
    responseStyle: 'concise' | 'balanced' | 'detailed';
    customInstructions: string;
  };
  voice: {
    speechToTextModel: string;
    englishModel: string;
    englishVoice: string;
    danishVoice: string;
    defaultLanguage: 'da' | 'en';
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
  [Area in keyof Settings]?: Partial<Settings[Area]>;
};

export interface SettingsStore {
  read(): Promise<Record<string, unknown>>;
  write(settings: SettingsPatch): Promise<void>;
}

export const defaultSettings: Settings = {
  jarvis: { model: 'gpt-5.6-luna', reasoning: 'none' },
  personality: {
    tone: 'british_butler',
    responseStyle: 'concise',
    customInstructions: '',
  },
  voice: {
    speechToTextModel: 'mai-transcribe',
    englishModel: 'gpt-realtime-2.1',
    englishVoice: 'en-GB-Ryan:DragonHDLatestNeural',
    danishVoice: 'da-DK-Harper:MAI-Voice-2',
    defaultLanguage: 'da',
  },
  codex: { model: 'default', reasoning: 'default' },
  copilot: { model: 'default' },
  global: { maxParallelTasks: 1, maxCheckAttempts: 3, screenShareDailyFrameCap: 300 },
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
  jarvis: { model: 'jarvis.model', reasoning: 'jarvis.reasoning_effort' },
  personality: {
    tone: 'personality.tone',
    responseStyle: 'personality.response_style',
    customInstructions: 'personality.custom_instructions',
  },
  voice: {
    speechToTextModel: 'voice.stt.model',
    englishModel: 'voice.en.model',
    englishVoice: 'voice.en.voice',
    danishVoice: 'voice.da.voice',
    defaultLanguage: 'voice.default_language',
  },
  codex: { model: 'codex.model', reasoning: 'codex.reasoning_effort' },
  copilot: { model: 'copilot.model' },
  global: {
    maxParallelTasks: 'global.max_parallel_tasks',
    maxCheckAttempts: 'global.max_check_attempts',
    screenShareDailyFrameCap: 'global.screen_share_daily_frame_cap',
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

function isOption(value: unknown, options: readonly string[]): value is string {
  return typeof value === 'string' && options.includes(value);
}

function validSetting(area: keyof Settings, key: string, value: unknown): boolean {
  if (area === 'jarvis') {
    if (key === 'model') return isOption(value, settingsOptions.jarvisModels);
    if (key === 'reasoning') return isOption(value, settingsOptions.reasoningEfforts);
  }
  if (area === 'personality') {
    if (key === 'tone') return isOption(value, settingsOptions.personalityTones);
    if (key === 'responseStyle') return isOption(value, settingsOptions.personalityResponseStyles);
    if (key === 'customInstructions') {
      return typeof value === 'string' && value.length <= 2_000 &&
        ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return code < 0x20 && character !== '\n' && character !== '\r' && character !== '\t';
        });
    }
  }
  if (area === 'voice') {
    if (key === 'speechToTextModel') return isOption(value, settingsOptions.speechToTextModels);
    if (key === 'englishModel') return isOption(value, settingsOptions.englishModels);
    if (key === 'englishVoice') return isOption(value, settingsOptions.englishVoices);
    if (key === 'danishVoice') return isOption(value, settingsOptions.danishVoices);
    if (key === 'defaultLanguage') return isOption(value, settingsOptions.languages);
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
        (merged[area] as Record<string, unknown>)[key] = value;
      }
    }
  }
  return merged;
}

function parseStoredValues(values: Record<string, unknown>): Partial<Settings> {
  const stored: Record<string, Record<string, unknown>> = {};
  for (const area of Object.keys(settingKeys) as (keyof Settings)[]) {
    for (const key of Object.keys(settingKeys[area]) as (keyof Settings[typeof area])[]) {
      const persisted = values[settingKeys[area][key] as string];
      if (persisted === undefined) continue;
      let value: unknown;
      try { value = JSON.parse(String(persisted)); } catch { continue; }
      if (validSetting(area, key, value)) {
        (stored[area] ??= {})[key as string] = value;
      }
    }
  }
  return stored as Partial<Settings>;
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
      entries.push({ key: settingKeys[area][key] as string, value: JSON.stringify(value) });
    }
  }
  return entries;
}

export async function registerSettingsRoutes(app: import('fastify').FastifyInstance) {
  app.get('/settings', async (_request, reply) => {
    if (!app.settingsStore) return reply.code(503).send({ error: 'Settings unavailable' });
    const credentials = await app.credentialStatusStore?.list() ?? [];
    return { settings: await readSettings(app.settingsStore), options: settingsOptions, credentials };
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
              },
              required: ['tone', 'responseStyle', 'customInstructions'],
              additionalProperties: false,
            },
          },
          required: ['model', 'reasoningEffort', 'personality'],
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
    return {
      model: settings.jarvis.model,
      reasoningEffort: settings.jarvis.reasoning,
      personality: settings.personality,
    };
  });

  app.patch('/settings', { schema: { body: settingsPatchSchema } }, async (request, reply) => {
    if (!app.settingsStore) return reply.code(503).send({ error: 'Settings unavailable' });
    const body = request.body as { settings: unknown };
    if (!isSettingsPatch(body.settings)) return reply.code(400).send({ error: 'Invalid setting value' });
    const patch = body.settings;
    await app.settingsStore.write(patch);
    const credentials = await app.credentialStatusStore?.list() ?? [];
    return { settings: await readSettings(app.settingsStore), options: settingsOptions, credentials };
  });
}

export { flattenSettings };
