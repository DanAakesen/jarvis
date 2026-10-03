export interface Settings {
  jarvis: {
    model: string;
    reasoning: string;
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
  voice: {
    speechToTextModel: 'mai-transcribe',
    englishModel: 'gpt-realtime-2.1',
    englishVoice: 'en-GB-Ryan:DragonHDLatestNeural',
    danishVoice: 'da-DK-Harper:MAI-Voice-2',
    defaultLanguage: 'da',
  },
  codex: { model: 'default', reasoning: 'default' },
  copilot: { model: 'default' },
  global: { maxParallelTasks: 1 },
};

export const settingsOptions = {
  jarvisModels: ['gpt-5.6-luna'],
  reasoningEfforts: ['none', 'low', 'medium', 'high'],
  speechToTextModels: ['mai-transcribe'],
  englishModels: ['gpt-realtime-2.1'],
  englishVoices: ['en-GB-Ryan:DragonHDLatestNeural'],
  danishVoices: ['da-DK-Harper:MAI-Voice-2'],
  languages: ['da', 'en'],
  codexModels: ['default'],
  codexReasoningEfforts: ['default'],
  copilotModels: ['default'],
} as const;

const settingKeys = {
  jarvis: { model: 'jarvis.model', reasoning: 'jarvis.reasoning_effort' },
  voice: {
    speechToTextModel: 'voice.stt.model',
    englishModel: 'voice.en.model',
    englishVoice: 'voice.en.voice',
    danishVoice: 'voice.da.voice',
    defaultLanguage: 'voice.default_language',
  },
  codex: { model: 'codex.model', reasoning: 'codex.reasoning_effort' },
  copilot: { model: 'copilot.model' },
  global: { maxParallelTasks: 'global.max_parallel_tasks' },
} as const;

function isOption(value: unknown, options: readonly string[]): value is string {
  return typeof value === 'string' && options.includes(value);
}

function validSetting(area: keyof Settings, key: string, value: unknown): boolean {
  if (area === 'jarvis') {
    if (key === 'model') return isOption(value, settingsOptions.jarvisModels);
    if (key === 'reasoning') return isOption(value, settingsOptions.reasoningEfforts);
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
          properties: { maxParallelTasks: { type: 'integer', minimum: 1, maximum: 100 } },
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
    const stored = await app.settingsStore.read();
    return { settings: mergeSettings(parseStoredValues(stored)), options: settingsOptions };
  });

  app.patch('/settings', { schema: { body: settingsPatchSchema } }, async (request, reply) => {
    if (!app.settingsStore) return reply.code(503).send({ error: 'Settings unavailable' });
    const body = request.body as { settings: unknown };
    if (!isSettingsPatch(body.settings)) return reply.code(400).send({ error: 'Invalid setting value' });
    const patch = body.settings;
    await app.settingsStore.write(patch);
    const stored = await app.settingsStore.read();
    return { settings: mergeSettings(parseStoredValues(stored)), options: settingsOptions };
  });
}

export { flattenSettings };
