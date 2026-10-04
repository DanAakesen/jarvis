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
  appearance: { theme: 'light' },
  jarvis: { model: 'gpt-5.6-luna', reasoning: 'none' },
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
  global: { maxParallelTasks: 1, maxCheckAttempts: 3 },
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
  Object.values(settingKeys).flatMap((area) => Object.values(area)),
);

function isOption(value: unknown, options: readonly string[]): value is string {
  return typeof value === 'string' && options.includes(value);
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
          properties: { model: { type: 'string' }, reasoningEffort: { type: 'string' } },
          required: ['model', 'reasoningEffort'],
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
    return { model: settings.jarvis.model, reasoningEffort: settings.jarvis.reasoning };
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
