import type { JarvisTool } from './tool-registry.js';
import { ToolRefusal } from './tool-registry.js';
import { readSettings } from './settings.js';
import { isRoleModelSupported, modelsForRole, reasoningForModel } from './model-catalog.js';
import type { ReasoningEffort } from '@jarvis/contracts';

interface SetJarvisModelInput {
  model?: string;
  reasoning?: string;
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
    const store = request.server.settingsStore;
    if (!store) throw new Error('Settings unavailable');
    const catalogue = await request.server.modelCatalogue.read();
    const settings = await readSettings(store, catalogue);
    const next = {
      model: model ?? settings.roles.chat.model,
      reasoningEffort: reasoning ?? settings.roles.chat.reasoningEffort,
    };
    const modelOptions = modelsForRole(catalogue, 'chat');
    if (model !== undefined && !modelOptions.includes(model)) {
      throw new ToolRefusal(`Unsupported Jarvis model. Valid models: ${modelOptions.join(', ')}.`);
    }
    const effortOptions = reasoningForModel(catalogue, 'chat', next.model);
    if (reasoning !== undefined && !effortOptions.includes(reasoning as ReasoningEffort)) {
      throw new ToolRefusal(`Unsupported Jarvis reasoning. Valid reasoning levels: ${effortOptions.join(', ')}.`);
    }
    if (!isRoleModelSupported(catalogue, 'chat', next.model, next.reasoningEffort)) {
      throw new ToolRefusal(`Unsupported Jarvis model or reasoning. Valid reasoning levels: ${effortOptions.join(', ')}.`);
    }
    await store.write({ roles: { chat: { ...next, reasoningEffort: next.reasoningEffort as ReasoningEffort } } });
    const updated = await readSettings(store, catalogue);
    return {
      model: updated.roles.chat.model,
      reasoning: updated.roles.chat.reasoningEffort,
      applies: 'next session',
    };
  },
};
