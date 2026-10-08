import type { ReasoningEffort } from '@jarvis/contracts';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';
import { readSettings } from './settings.js';
import { applySettingsPatch } from './settings-tools.js';
import { isRoleModelSupported, modelsForRole, reasoningForModel } from './model-catalog.js';

interface SetJarvisModelInput {
  model?: string;
  reasoning?: string;
}

export const setJarvisModelTool: JarvisTool = {
  name: 'set_jarvis_model',
  description: 'Compatibility alias for update_settings: set the chat model or reasoning for the next chat or Danish voice session.',
  inputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', minLength: 1, maxLength: 100 },
      reasoning: { type: 'string', minLength: 1, maxLength: 32 },
    },
    anyOf: [{ required: ['model'] }, { required: ['reasoning'] }],
    additionalProperties: false,
  },
  sensitive: true,
  execute: async (input, request, signal) => {
    const { model, reasoning } = input as SetJarvisModelInput;
    if (!request.server.settingsStore) throw new ToolRefusal('Settings are unavailable.');
    const catalogue = await request.server.modelCatalogue.read();
    const current = await readSettings(request.server.settingsStore, catalogue);
    const nextModel = model ?? current.roles.chat.model;
    const nextReasoning = reasoning ?? current.roles.chat.reasoningEffort;
    const modelOptions = modelsForRole(catalogue, 'chat');
    if (model !== undefined && !modelOptions.includes(model)) {
      throw new ToolRefusal(`Unsupported Jarvis model. Valid models: ${modelOptions.join(', ')}.`);
    }
    const effortOptions = reasoningForModel(catalogue, 'chat', nextModel);
    if (reasoning !== undefined && !effortOptions.includes(reasoning as ReasoningEffort)) {
      throw new ToolRefusal(`Unsupported Jarvis reasoning. Valid reasoning levels: ${effortOptions.join(', ')}.`);
    }
    if (!isRoleModelSupported(catalogue, 'chat', nextModel, nextReasoning)) {
      throw new ToolRefusal(`Unsupported Jarvis model or reasoning. Valid reasoning levels: ${effortOptions.join(', ')}.`);
    }
    const updated = await applySettingsPatch(request, {
      roles: {
        chat: {
          ...(model === undefined ? {} : { model }),
          ...(reasoning === undefined ? {} : { reasoningEffort: reasoning }),
        },
      },
    }, signal);
    return {
      model: updated.roles.chat.model,
      reasoning: updated.roles.chat.reasoningEffort,
      applies: 'next session',
    };
  },
};
