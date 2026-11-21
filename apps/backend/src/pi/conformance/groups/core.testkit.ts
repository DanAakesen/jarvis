import { createConversationModule } from '../../../core/conversation.js';
import { coreModule } from '../../../core/index.js';
import { createRecipeModule } from '../../../core/recipe-management.js';
import { createBackendLogsModule, loadBackendLogsConfig } from '../../../operations/backend-logs.js';
import { createSleepModule } from '../../../operations/sleep.js';
import { createPhoneStatusModule } from '../../../phone/status.js';
import { createGithubWebhookModule } from '../../../github/webhook.js';
import { createNotesFolderOrderModule } from '../../../vault/folder-order.js';
import type { GroupFactory } from '../types.testkit.js';
import { unstubbed } from '../stub.testkit.js';

/**
 * Settings, status, jobs, usage, workspace commands, theme, presence, conversation search and attachments, routines and the
 * backend log reader, plus the tool-less modules that only add routes (sleep, phone status, GitHub webhook, folder order).
 */
export const coreGroup: GroupFactory = () => ({
  id: 'core',
  covers: ['core', 'conversation', 'sleep', 'recipes', 'backendLogs', 'phoneStatus', 'githubWebhook', 'notesFolderOrder'],
  modules: [
    coreModule,
    createConversationModule(),
    createSleepModule(null),
    createRecipeModule(unstubbed('recipeStore')),
    createBackendLogsModule({
      config: loadBackendLogsConfig({
        JARVIS_BACKEND_LOGS_ENABLED: 'true',
        JARVIS_BACKEND_LOGS_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
        JARVIS_BACKEND_LOGS_APP_NAME: 'ca-jarvis-backend-test',
      }),
      getToken: unstubbed('backendLogs.getToken'),
    }),
    createPhoneStatusModule({ configured: false, store: null }),
    createGithubWebhookModule({ deliveryStore: null, getSecret: async () => undefined, isTrackedRepository: () => false, onMapping: async () => {} }),
    createNotesFolderOrderModule(unstubbed('notesFolderOrderStore')),
  ],
});
