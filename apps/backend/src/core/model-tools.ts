import type { JarvisTool } from './tool-registry.js';
import { ToolRefusal } from './tool-registry.js';
import { readSettings, settingsOptions } from './settings.js';

interface SetJarvisModelInput {
  model?: string;
  reasoning?: string;
}

function isOption(value: string, options: readonly string[]): boolean {
  return options.includes(value);
}

function optionsList(options: readonly string[]): string {
  return options.join(', ');
}

export const setJarvisModelTool: JarvisTool = {
  name: 'set_jarvis_model',
  description: 'Set Jarvis’s model or reasoning for the next chat or Danish voice session.',
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', minLength: 1, maxLength: 100 },
      reasoning: { type: 'string', minLength: 1, maxLength: 32 },
    },
    anyOf: [{ required: ['model'] }, { required: ['reasoning'] }],
    additionalProperties: false,
  },
  execute: async (input, request) => {
    const { model, reasoning } = input as SetJarvisModelInput;
    if (model !== undefined && !isOption(model, settingsOptions.jarvisModels)) {
      throw new ToolRefusal(`Unsupported Jarvis model. Valid models: ${optionsList(settingsOptions.jarvisModels)}.`);
    }
    if (reasoning !== undefined && !isOption(reasoning, settingsOptions.reasoningEfforts)) {
      throw new ToolRefusal(`Unsupported Jarvis reasoning. Valid reasoning levels: ${optionsList(settingsOptions.reasoningEfforts)}.`);
    }

    const store = request.server.settingsStore;
    if (!store) throw new Error('Settings unavailable');
    await store.write({
      jarvis: {
        ...(model !== undefined ? { model } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
      },
    });
    const settings = await readSettings(store);
    return {
      model: settings.jarvis.model,
      reasoning: settings.jarvis.reasoning,
      applies: 'next session',
    };
  },
};
