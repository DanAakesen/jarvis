import type { JarvisTool } from './tool-registry.js';
import { settingsOptions, type SettingsPatch } from './settings.js';
import { applySettingsPatch } from './settings-tools.js';

const hexColor = { type: ['string', 'null'], pattern: '^#[0-9a-fA-F]{6}$', maxLength: 7 };
const enumSchema = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const numberSchema = (minimum: number, maximum: number) => ({
  type: ['number', 'null'],
  not: { type: 'null' },
  minimum,
  maximum,
});

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
        reset: { type: 'boolean', const: true },
        background: enumSchema(settingsOptions.backgrounds),
        glow: numberSchema(0, 1),
        motion: enumSchema(settingsOptions.themeMotions),
        radius: numberSchema(0, 24),
        density: enumSchema(settingsOptions.themeDensities),
      },
    },
  },
  required: ['tokens'],
  additionalProperties: false,
} as const;

type ThemeTokenPatch = {
  appearance?: typeof settingsOptions.themes[number];
  accent?: string | null;
  'accent-secondary'?: string | null;
  'surface-tint'?: string | null;
  reset?: true;
  background?: typeof settingsOptions.backgrounds[number];
  glow?: number;
  motion?: typeof settingsOptions.themeMotions[number];
  radius?: number;
  density?: typeof settingsOptions.themeDensities[number];
};

function settingsPatch(value: unknown): SettingsPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { appearance: {} };
  const { appearance: theme, reset, ...tokens } = value as Record<string, unknown>;
  const appearance = {
    ...tokens,
    ...(theme === undefined ? {} : { theme }),
    ...(reset === true ? { accent: null, 'accent-secondary': null, 'surface-tint': null } : {}),
  };
  return {
    appearance: appearance as SettingsPatch['appearance'],
  };
}

export const setThemeTool: JarvisTool = {
  name: 'set_theme',
  description: 'Set allowlisted Jarvis appearance tokens. Set a colour to null to remove its override and use the theme default, or use reset: true to remove all three colour overrides.',
  inputSchema,
  async execute(input, request, signal) {
    if (signal.aborted) throw new Error('Theme update was cancelled.');
    const tokens = typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as { tokens?: unknown }).tokens
      : undefined;
    const patch = settingsPatch(tokens);
    await applySettingsPatch(request, patch, signal);
    const normalizedTokens = typeof tokens === 'object' && tokens !== null && !Array.isArray(tokens) && (tokens as ThemeTokenPatch).reset
      ? { ...(tokens as ThemeTokenPatch), accent: null, 'accent-secondary': null, 'surface-tint': null }
      : tokens;
    return { updated: true, tokens: normalizedTokens };
  },
};
