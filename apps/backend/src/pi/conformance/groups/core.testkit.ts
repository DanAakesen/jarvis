import type { SystemSmokeCheckId } from '@jarvis/contracts';
import { createConversationModule } from '../../../core/conversation.js';
import { coreModule } from '../../../core/index.js';
import { createRecipeModule } from '../../../core/recipe-management.js';
import type { BackendModule } from '../../../modules.js';
import { createBackendLogsModule, loadBackendLogsConfig } from '../../../operations/backend-logs.js';
import { createSleepModule } from '../../../operations/sleep.js';
import { createPhoneStatusModule } from '../../../phone/status.js';
import { createGithubWebhookModule } from '../../../github/webhook.js';
import { createNotesFolderOrderModule } from '../../../vault/folder-order.js';
import type { SystemStatusProbe } from '../../../system-status.js';
import type { GroupFactory, ToolCase } from '../types.testkit.js';
import {
  attachmentIds, attachmentVisionFake, createAttachmentsFake, createAwayModeFake, createBackgroundJobFake, createCodexRenewalFake,
  createContainerAppScalerFake, createConversationSummaryFake, createCredentialStatusFake, createLogAnalyticsFetch, createModelCatalogueFake,
  createModelDeploymentFake, createNotesFolderOrderFake, createNowFeedFake, createOwnerInteractionsFake, createPhoneSessionFake,
  createRecipeFake, createSettingsFake, createSystemStatusFake, createTaskStatusNotificationFake, createUsageFake, createWebhookDeliveryFake,
  createWorkspaceTabFake, installConversationSearch, routineIds, seededJobIds, startRunningJobs, systemSmokeProbesFake, tabWindows,
} from './core-stubs.testkit.js';

const logsAppName = 'ca-jarvis-backend-test';

const textView = (title: string, content: string) => ({
  version: 1, title, renderer: 'text', source: { id: 'now', status: 'complete' }, data: { format: 'plain', content },
});
const listView = (title: string, items: readonly { title: string; description?: string }[]) => ({
  version: 1, title, renderer: 'list', source: { id: 'now', status: 'complete' }, data: { items },
});

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const expectFields = (result: unknown, fields: Readonly<Record<string, unknown>>) => {
  if (!isObject(result)) throw new Error(`expected an object result, got ${JSON.stringify(result)?.slice(0, 120)}`);
  for (const [key, value] of Object.entries(fields)) {
    if (JSON.stringify(result[key]) !== JSON.stringify(value)) throw new Error(`expected ${key} = ${JSON.stringify(value)}, got ${JSON.stringify(result[key])}`);
  }
};
const expectList = (result: unknown, key: string) => {
  if (!isObject(result) || !Array.isArray(result[key]) || result[key].length === 0) throw new Error(`expected a non-empty ${key} list`);
};

/**
 * Settings, status, jobs, usage, workspace commands, theme, presence, conversation search and attachments, routines and the
 * backend log reader, plus the tool-less modules that only add routes (sleep, phone status, GitHub webhook, folder order).
 * Every store is in memory; Dan's browser tab is a fake tab that acknowledges every workspace command.
 */
export const coreGroup: GroupFactory = (context) => {
  const settingsStore = createSettingsFake();
  const modelCatalogue = createModelCatalogueFake();
  const ownerInteractions = createOwnerInteractionsFake(context.owner);
  const credentialStatusStore = createCredentialStatusFake();
  const scaler = createContainerAppScalerFake();
  const workspaceCommands = createWorkspaceTabFake(context);
  const logsConfig = loadBackendLogsConfig({
    JARVIS_BACKEND_LOGS_ENABLED: 'true',
    JARVIS_BACKEND_LOGS_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
    JARVIS_BACKEND_LOGS_APP_NAME: logsAppName,
  });

  /** The arguments of the case that cancels a job by id; the id exists only once the registry has started the job. */
  const cancelById: Record<string, unknown> = {};

  /** What a running backend has by the time Dan asks: probes read, deploy smoke run, jobs started. */
  const core: BackendModule = {
    ...coreModule,
    registerServices: (app) => {
      app.addHook('onReady', async () => {
        await app.systemStatusReader.read();
        await app.systemSmokeReader.run();
        cancelById.jobId = (await startRunningJobs(app)).cancellableJobId;
      });
    },
  };
  const conversation: BackendModule = { ...createConversationModule(), registerServices: (app) => installConversationSearch(app.conversationStore) };

  const isoSecondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1_000).toISOString();

  const cases: Record<string, readonly ToolCase[]> = {
    set_theme: [
      { label: 'dark appearance', arguments: { tokens: { appearance: 'dark' } }, check: (result) => expectFields(result, { updated: true }) },
      { label: 'accent colour and glow', arguments: { tokens: { accent: '#3366ff', glow: 0.4 } } },
      { label: 'reset the colour overrides', arguments: { tokens: { reset: true } } },
    ],
    get_settings: [
      { label: 'every area', arguments: {}, check: (result) => { if (!isObject(result) || !isObject(result.settings) || !isObject(result.options)) throw new Error('expected settings and options'); } },
      { label: 'roles', arguments: { area: 'roles' } },
      { label: 'appearance', arguments: { area: 'appearance' } },
      { label: 'home brief', arguments: { area: 'homeBrief' } },
    ],
    update_settings: [
      { label: 'presentation', arguments: { settings: { presentation: { showWork: false } } } },
      { label: 'chat reasoning role', arguments: { settings: { roles: { chat: { reasoningEffort: 'low' } } } } },
      { label: 'vision budget', arguments: { settings: { global: { visionDailyBudgetUsd: 2 } } } },
      { label: 'personality', arguments: { settings: { personality: { tone: 'warm', responseStyle: 'balanced' } } } },
    ],
    set_jarvis_model: [
      { label: 'another chat model', arguments: { model: 'gpt-6-luna' }, check: (result) => expectFields(result, { model: 'gpt-6-luna' }) },
      { label: 'reasoning only', arguments: { reasoning: 'low' }, check: (result) => expectFields(result, { reasoning: 'low' }) },
      { label: 'model and reasoning', arguments: { model: 'gpt-6.1-terra', reasoning: 'medium' } },
    ],
    manage_model_deployment: [
      {
        label: 'create a deployment of a catalogue model',
        arguments: { action: 'create', model: 'gpt-6-luna', version: '2026-10-15', sku: 'GlobalStandard', capacity: 10 },
        check: (result) => expectFields(result, { name: 'gpt-6-luna-2026-10-15', status: 'accepted' }),
      },
      { label: 'delete an unused deployment', arguments: { action: 'delete', name: 'text-embedding-3-large' }, check: (result) => expectFields(result, { status: 'accepted' }) },
    ],
    get_usage: ['today', '7d', '30d', '90d', 'all'].map((period) => ({
      label: `period ${period}`, arguments: { period },
      check: (result: unknown) => { expectFields(result, { period }); if (!isObject(result) || !isObject(result.total)) throw new Error('expected a spend total'); },
    })),
    workspace_command: [
      { label: 'navigate to a settings section', arguments: { commandId: 'nav-settings', operation: 'navigate', page: 'settings', section: 'appearance' } },
      { label: 'navigate to the home page', arguments: { commandId: 'nav-home', operation: 'navigate', page: 'home' } },
      { label: 'navigate to a factory task', arguments: { commandId: 'nav-task', operation: 'navigate', page: 'factory', taskId: '5' } },
      {
        label: 'create a text view', arguments: { commandId: 'create-summary', operation: 'create', viewId: 'summary-view', view: textView('Summary', 'You spent 5,000 DKK this month.') },
        check: (result) => expectFields(result, { type: 'generated-view' }),
      },
      {
        label: 'create a list view', arguments: { commandId: 'create-hotels', operation: 'create', viewId: 'hotels-found', view: listView('Hotels found', [{ title: 'Hotel Alpha', description: 'Booked 12 Nov, 3 nights' }]) },
      },
      { label: 'update a view', arguments: { commandId: 'update-summary', operation: 'update', viewId: 'summary-view', view: textView('Summary', 'You spent 5,200 DKK this month.') } },
      { label: 'show a window', arguments: { commandId: 'show-chart', operation: 'show', viewId: tabWindows.chart } },
      { label: 'focus a window', arguments: { commandId: 'focus-chart', operation: 'focus', viewId: tabWindows.chart } },
      { label: 'minimise a window', arguments: { commandId: 'minimise-notes', operation: 'minimise', viewId: tabWindows.notes } },
      { label: 'restore a window', arguments: { commandId: 'restore-notes', operation: 'restore', viewId: tabWindows.notes } },
      { label: 'move a window', arguments: { commandId: 'move-chart', operation: 'move', viewId: tabWindows.chart, x: 0.2, y: 0.1 } },
      { label: 'resize a window', arguments: { commandId: 'resize-chart', operation: 'resize', viewId: tabWindows.chart, width: 0.5, height: 0.5 } },
      { label: 'place a window in a region', arguments: { commandId: 'place-chart', operation: 'place', viewId: tabWindows.chart, region: 'left' } },
      { label: 'arrange side by side', arguments: { commandId: 'arrange-pair', operation: 'arrange', layout: 'side-by-side', viewIds: [tabWindows.chart, tabWindows.notes] } },
      { label: 'tidy up automatically', arguments: { commandId: 'arrange-auto', operation: 'arrange', layout: 'auto' } },
      { label: 'tile the layout', arguments: { commandId: 'layout-tiled', operation: 'layout', arrangement: 'tiled' } },
      { label: 'pin a window', arguments: { commandId: 'pin-chart', operation: 'pin', viewId: tabWindows.chart } },
      { label: 'unpin a window', arguments: { commandId: 'unpin-chart', operation: 'unpin', viewId: tabWindows.chart } },
      { label: 'minimise everything', arguments: { commandId: 'minimise-everything', operation: 'minimise-all' } },
      { label: 'restore everything', arguments: { commandId: 'restore-everything', operation: 'restore-all' } },
      { label: 'show the conversation', arguments: { commandId: 'conversation-show', operation: 'conversation', action: 'show' } },
      { label: 'turn the camera off', arguments: { commandId: 'session-camera', operation: 'session', action: 'camera', value: 'off' } },
      { label: 'end the voice session', arguments: { commandId: 'session-voice', operation: 'session', action: 'voice', value: 'end' } },
      {
        label: 'a language switch is refused with the actions the page supports',
        arguments: { commandId: 'session-language', operation: 'session', action: 'language', value: 'en' }, expect: 'refused',
        check: (result) => { if (!isObject(result) || !String(result.refused).includes('action: must be voice or camera')) throw new Error(`expected the supported session actions, got ${JSON.stringify(result)}`); },
      },
      { label: 'open the context panel on a view', arguments: { commandId: 'panel-open', operation: 'context-panel', action: 'open', view: textView('Context', 'Notes for the meeting.') } },
      { label: 'close the context panel', arguments: { commandId: 'panel-close', operation: 'context-panel', action: 'close' } },
      { label: 'close a window', arguments: { commandId: 'close-notes', operation: 'close', viewId: tabWindows.notes } },
      { label: 'close everything', arguments: { commandId: 'close-everything', operation: 'close-all' } },
    ],
    read_window: [
      { label: 'a window with page-reported content', arguments: { viewId: tabWindows.chart }, check: (result) => expectFields(result, { viewId: tabWindows.chart, untrusted: true }) },
      { label: 'a window with a selection only', arguments: { viewId: tabWindows.notes } },
    ],
    get_job: [
      { label: 'a finished research job', arguments: { jobId: seededJobIds.done }, check: (result) => { if (!isObject(result) || !isObject(result.job)) throw new Error('expected the job'); } },
      { label: 'a failed job that can be retried', arguments: { jobId: seededJobIds.failed }, check: (result) => expectFields(result, { retryable: true }) },
    ],
    cancel_job: [
      { label: 'by words from the title', arguments: { query: 'Cheap flights' }, check: (result) => expectFields(result, { cancelled: 'Cheap flights to Lisbon' }) },
      { label: 'by job id', arguments: cancelById },
    ],
    conversation_search: [
      { label: 'keywords', arguments: { query: 'dentist' }, check: (result) => expectList(result, 'results') },
      { label: 'with a source and a date range', arguments: { query: 'weather', source: 'voice', from: '2026-11-01', to: '2026-11-30', limit: 5 } },
    ],
    attachment_read: [
      { label: 'the first page of a text file', arguments: { id: attachmentIds.budget }, check: (result) => { if (!isObject(result) || typeof result.content !== 'string' || !result.content.includes('Rent')) throw new Error('expected the file text'); } },
      { label: 'a search snippet', arguments: { id: attachmentIds.budget, query: 'Savings' } },
      { label: 'the description of an image', arguments: { id: attachmentIds.receipt } },
    ],
    show_in_chat: [
      {
        label: 'a forecast',
        arguments: {
          version: 1, type: 'forecast', title: 'Aarhus tomorrow', source: { label: 'Open-Meteo', status: 'complete' },
          summary: 'Cloudy in Aarhus tomorrow, high 9 °C, low 4 °C, 30% chance of rain.',
          data: { place: 'Aarhus', date: '2026-11-22', conditions: 'Cloudy', symbol: 'cloudy', highC: 9, lowC: 4, rainChancePercent: 30 },
        },
        check: (result) => { if (!isObject(result) || typeof result.blockId !== 'string') throw new Error('expected a block id'); },
      },
      {
        label: 'a chart',
        arguments: {
          version: 1, type: 'chart', title: 'Temperature this week', source: { label: 'Open-Meteo', status: 'complete' },
          summary: 'Temperature in Aarhus rises from 4 °C on Monday to 9 °C on Wednesday.',
          data: { xLabel: 'Day', panels: [{ title: 'Temperature', unit: '°C', kind: 'line', series: [{ name: 'Aarhus', points: [{ x: 'Mon', y: 4 }, { x: 'Tue', y: 6 }, { x: 'Wed', y: 9 }] }] }] },
        },
      },
      {
        label: 'a view',
        arguments: {
          version: 1, type: 'view', title: 'Open tasks', source: { label: 'Jarvis tasks', status: 'complete' },
          summary: 'Two open tasks: buy milk and book the dentist.',
          data: { view: listView('Open tasks', [{ title: 'Buy milk' }, { title: 'Book the dentist' }]) },
        },
      },
    ],
    task_routines: [
      { label: 'list the routines', arguments: { action: 'list' }, check: (result) => expectList(result, 'routines') },
      { label: 'rename a routine', arguments: { action: 'rename', id: routineIds.pcRename, name: 'Morning mix' }, check: (result) => expectFields(result, { updated: true }) },
      { label: 'delete a routine', arguments: { action: 'delete', id: routineIds.pcDelete }, check: (result) => expectFields(result, { deleted: true }) },
    ],
    task_recipes: [
      { label: 'list the routines under the legacy name', arguments: { action: 'list' }, check: (result) => expectList(result, 'recipes') },
      { label: 'rename a routine', arguments: { action: 'update', id: routineIds.legacyRename, name: 'Weather today' }, check: (result) => expectFields(result, { updated: true }) },
      { label: 'delete a routine', arguments: { action: 'delete', id: routineIds.legacyDelete }, check: (result) => expectFields(result, { deleted: true }) },
    ],
    read_backend_logs: [
      { label: 'the last 15 minutes', arguments: {}, check: (result) => expectFields(result, { status: 'ok', trust: 'untrusted_evidence' }) },
      { label: 'a window of one hour with a limit', arguments: { start: isoSecondsAgo(2 * 3_600), end: isoSecondsAgo(3_600), limit: 10 }, check: (result) => expectFields(result, { status: 'ok' }) },
    ],
  };

  return {
    id: 'core',
    covers: ['core', 'conversation', 'sleep', 'recipes', 'backendLogs', 'phoneStatus', 'githubWebhook', 'notesFolderOrder'],
    modules: [
      core,
      conversation,
      createSleepModule(scaler),
      createRecipeModule(createRecipeFake()),
      createBackendLogsModule({
        config: logsConfig,
        getToken: async () => 'conformance-log-analytics-token',
        fetch: createLogAnalyticsFetch(logsAppName),
      }),
      createPhoneStatusModule({ configured: true, store: createPhoneSessionFake() }),
      createGithubWebhookModule({
        deliveryStore: createWebhookDeliveryFake(), getSecret: async () => 'conformance-webhook-secret',
        isTrackedRepository: (repository) => repository === 'DanAakesen/jarvis', onMapping: async () => {},
      }),
      createNotesFolderOrderModule(createNotesFolderOrderFake()),
    ],
    appOptions: {
      settingsStore,
      modelCatalogue,
      modelDeploymentWorkflow: createModelDeploymentFake(modelCatalogue, settingsStore, ownerInteractions),
      credentialStatusStore,
      renewCodexCredential: createCodexRenewalFake(credentialStatusStore),
      usageStore: createUsageFake(),
      backgroundJobStore: createBackgroundJobFake(),
      nowFeedStore: createNowFeedFake(),
      awayModeStore: createAwayModeFake(),
      conversationAttachments: createAttachmentsFake(),
      conversationSummaryStore: createConversationSummaryFake(),
      attachmentVision: attachmentVisionFake,
      ownerInteractions,
      workspaceCommands,
      systemStatusReader: createSystemStatusFake(),
      systemSmokeProbes: systemSmokeProbesFake as Partial<Record<SystemSmokeCheckId, SystemStatusProbe>>,
      phoneSessionStore: createPhoneSessionFake(),
      taskStatusNotificationStore: createTaskStatusNotificationFake(),
      containerAppScaler: scaler,
    },
    cases,
  };
};
