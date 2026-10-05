import { ToolRefusal, type JarvisTool } from './tool-registry.js';
import { settingsOptions, type SettingsPatch } from './settings.js';

const hexColor = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', maxLength: 7 };
const enumSchema = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

const inputSchema = {
  type: 'object',
  properties: {
    tokens: {
      type: 'object',
      minProperties: 1,
      additionalProperties: false,
      properties: {
        appearance: enumSchema(settingsOptions.themes),
        accent: hexColor,
        'accent-secondary': hexColor,
        'surface-tint': hexColor,
        background: enumSchema(settingsOptions.backgrounds),
        glow: { type: 'number', minimum: 0, maximum: 1 },
        motion: enumSchema(settingsOptions.themeMotions),
        radius: { type: 'number', minimum: 0, maximum: 24 },
        density: enumSchema(settingsOptions.themeDensities),
      },
    },
  },
  required: ['tokens'],
  additionalProperties: false,
} as const;

type ThemeTokenPatch = {
  appearance?: typeof settingsOptions.themes[number];
  accent?: string;
  'accent-secondary'?: string;
  'surface-tint'?: string;
  background?: typeof settingsOptions.backgrounds[number];
  glow?: number;
  motion?: typeof settingsOptions.themeMotions[number];
  radius?: number;
  density?: typeof settingsOptions.themeDensities[number];
};

function isOption<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T);
}

function isThemeTokenPatch(value: unknown): value is ThemeTokenPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  return entries.every(([name, token]) => {
    if (!Object.hasOwn(inputSchema.properties.tokens.properties, name)) return false;
    if (name === 'appearance') return isOption(token, settingsOptions.themes);
    if (name === 'accent' || name === 'accent-secondary' || name === 'surface-tint') {
      return typeof token === 'string' && /^#[\da-f]{6}$/i.test(token);
    }
    if (name === 'background') return isOption(token, settingsOptions.backgrounds);
    if (name === 'glow') return typeof token === 'number' && Number.isFinite(token) && token >= 0 && token <= 1;
    if (name === 'motion') return isOption(token, settingsOptions.themeMotions);
    if (name === 'radius') return typeof token === 'number' && Number.isFinite(token) && token >= 0 && token <= 24;
    if (name === 'density') return isOption(token, settingsOptions.themeDensities);
    return false;
  });
}

function settingsPatch(tokens: ThemeTokenPatch): SettingsPatch {
  const { appearance, ...otherTokens } = tokens;
  return {
    appearance: {
      ...(appearance === undefined ? {} : { theme: appearance }),
      ...otherTokens,
    },
  };
}

export const setThemeTool: JarvisTool = {
  name: 'set_theme',
  description: 'Set one or more allowlisted Jarvis appearance tokens. Values are saved as Dan’s UI preferences.',
  inputSchema,
  async execute(input, request, signal) {
    if (signal.aborted) throw new Error('Theme update was cancelled.');
    const tokens = typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as { tokens?: unknown }).tokens
      : undefined;
    if (!isThemeTokenPatch(tokens)) {
      throw new ToolRefusal('Use one or more supported theme tokens with valid values.');
    }
    const settingsStore = request.server.settingsStore;
    if (!settingsStore) throw new ToolRefusal('Theme preferences are unavailable.');
    await settingsStore.write(settingsPatch(tokens));
    return { updated: true, tokens };
  },
};
