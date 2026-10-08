import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { SettingsStore } from './settings.js';
import { coreModule } from './index.js';
import {
  createArmModelDeploymentClient, createModelDeploymentWorkflow, ModelDeploymentError,
} from './model-deployments.js';
import type { ModelDeploymentClient } from './model-deployments.js';
import { fallbackModelCatalogue } from './model-catalog.js';
import type { ModelCatalogueReader } from './model-catalog.js';
import type { TeamsNotificationService } from '../teams/service.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const resourceId = '/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg-jarvis/providers/Microsoft.CognitiveServices/accounts/jarvis-prod';
const headers = {
  authorization: ['Bearer', ['e30', 'e30', 'sig'].join('.')].join(' '),
  'x-jarvis-message-id': '42',
};
const owner = {
  objectId: config.auth.ownerObjectId,
  tenantId: config.auth.tenantId,
  displayName: 'Dan',
};
const unusedDeployment = {
  name: 'custom-unused',
  model: 'gpt-5.6-luna',
  version: '2026-06-01',
  sku: 'GlobalStandard',
  capacity: 1,
  capabilities: ['chat', 'responses'] as const,
  reasoningEfforts: ['none'] as const,
};
const apps: ReturnType<typeof buildApp>[] = [];

function catalogueFixture(): ModelCatalogueReader {
  return {
    read: vi.fn(async () => ({
      ...fallbackModelCatalogue(),
      source: 'arm' as const,
      deployments: [...fallbackModelCatalogue().deployments, unusedDeployment],
    })),
    invalidate: vi.fn(),
  };
}

function settingsFixture(values: Record<string, unknown> = {}) {
  const settings: SettingsStore = {
    read: vi.fn(async () => ({ ...values })),
    write: vi.fn(async () => {}),
  };
  return settings;
}

function deferredConfirmation() {
  let approve!: () => void;
  const gate = new Promise<void>((resolve) => { approve = resolve; });
  const confirm = vi.fn(async <T>(
    _actionKind: 'model_deployment',
    _summary: string,
    action: () => Promise<T>,
  ) => {
    await gate;
    return action();
  });
  return { confirm, approve: () => approve() };
}

function workflowFixture(options: {
  readonly settings?: SettingsStore;
  readonly catalogue?: ModelCatalogueReader;
  readonly client?: ModelDeploymentClient;
  readonly confirm?: ReturnType<typeof deferredConfirmation>['confirm'];
} = {}) {
  const catalogue = options.catalogue ?? catalogueFixture();
  const settings = options.settings ?? settingsFixture();
  const client = options.client ?? {
    create: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  const confirmation = options.confirm ?? vi.fn(async <T>(
    _actionKind: 'model_deployment',
    _summary: string,
    action: () => Promise<T>,
  ) => action());
  const changed = vi.fn();
  const workflow = createModelDeploymentWorkflow({
    catalogue,
    settings,
    client,
    confirm: confirmation,
    onChanged: changed,
  });
  return { workflow, catalogue, settings, client, confirm: confirmation, changed };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Foundry model deployment manager', () => {
  it('keeps every core tool schema a plain object at the root for Voice Live and the Responses API', () => {
    for (const tool of coreModule.tools) {
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema.type, tool.name).toBe('object');
      for (const key of ['oneOf', 'anyOf', 'allOf', 'not', 'enum']) expect(schema, tool.name).not.toHaveProperty(key);
    }
  });

  it('writes and deletes only the configured account deployment resources via ARM', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const getToken = vi.fn(async () => 'managed-identity-token');
    const client = createArmModelDeploymentClient({ resourceId, getToken, fetcher });
    const deployment = {
      name: 'gpt-5.6-luna-2026-12-01',
      model: 'gpt-5.6-luna',
      version: '2026-12-01',
      sku: 'GlobalStandard',
      capacity: 25,
    };

    await client.create(deployment);
    const [createUrl, createRequest] = fetcher.mock.calls[0]!;
    expect(String(createUrl)).toBe(`https://management.azure.com${resourceId}/deployments/${deployment.name}?api-version=2024-10-01`);
    expect(createRequest?.method).toBe('PUT');
    expect(new Headers(createRequest?.headers).get('Authorization')).toBe(['Bearer', 'managed-identity-token'].join(' '));
    expect(JSON.parse(String(createRequest?.body))).toEqual({
      sku: { name: deployment.sku, capacity: deployment.capacity },
      properties: { model: { format: 'OpenAI', name: deployment.model, version: deployment.version } },
    });

    await client.delete(deployment.name);
    const [deleteUrl, deleteRequest] = fetcher.mock.calls[1]!;
    expect(String(deleteUrl)).toBe(`https://management.azure.com${resourceId}/deployments/${deployment.name}?api-version=2024-10-01`);
    expect(deleteRequest?.method).toBe('DELETE');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('limits model creation to the live catalogue and waits for the explicit confirmation', async () => {
    const approval = deferredConfirmation();
    const { workflow, client, confirm, catalogue, changed } = workflowFixture({ confirm: approval.confirm });
    const input = { model: 'gpt-5.6-luna', version: '2026-12-01', sku: 'GlobalStandard', capacity: 25 };
    const pending = await workflow.startCreate(input);

    expect(pending.name).toBe('gpt-5.6-luna-2026-12-01');
    expect(confirm).toHaveBeenCalledWith(
      'model_deployment',
      expect.stringContaining('gpt-5.6-luna'),
      expect.any(Function),
      undefined,
    );
    expect(client.create).not.toHaveBeenCalled();
    await expect(workflow.startCreate(input)).rejects.toMatchObject({ statusCode: 409 });

    approval.approve();
    await expect(pending.completion).resolves.toMatchObject({ ...input, name: pending.name, status: 'accepted' });
    expect(client.create).toHaveBeenCalledWith({ ...input, name: pending.name }, undefined);
    expect(catalogue.invalidate).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('rejects fallback and unknown catalogues before asking for confirmation', async () => {
    const catalogue = catalogueFixture();
    vi.mocked(catalogue.read).mockResolvedValueOnce({
      ...fallbackModelCatalogue(),
      source: 'fallback',
    });
    const { workflow, client, confirm } = workflowFixture({ catalogue });

    await expect(workflow.startCreate({
      model: 'gpt-5.6-luna', version: '2026-12-01', sku: 'GlobalStandard', capacity: 25,
    })).rejects.toMatchObject({ statusCode: 503 });
    await expect(workflow.startCreate({
      model: 'not-in-catalogue', version: '2026-12-01', sku: 'GlobalStandard', capacity: 25,
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(confirm).not.toHaveBeenCalled();
    expect(client.create).not.toHaveBeenCalled();
  });

  it('refuses deleting a deployment selected by a role and rechecks role use after approval', async () => {
    const usedSettings = settingsFixture({ 'roles.vision.model': '"gpt-6-luna"' });
    const first = workflowFixture({ settings: usedSettings });
    await expect(first.workflow.startDelete('gpt-6-luna')).rejects.toMatchObject({ statusCode: 409 });
    expect(first.client.delete).not.toHaveBeenCalled();

    const values: Record<string, unknown> = {};
    const settings = settingsFixture(values);
    const approval = deferredConfirmation();
    const second = workflowFixture({ settings, confirm: approval.confirm });
    const pending = await second.workflow.startDelete(unusedDeployment.name);
    values['roles.chat.model'] = JSON.stringify(unusedDeployment.name);
    approval.approve();

    await expect(pending.completion).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('selected by a model role'),
    });
    expect(second.client.delete).not.toHaveBeenCalled();
  });

  it('rejects unsafe ARM targets and provider errors', async () => {
    expect(() => createArmModelDeploymentClient({
      resourceId: 'https://attacker.example/deployments',
      getToken: async () => 'token',
    })).toThrow('Invalid Foundry account resource ID');
    const client = createArmModelDeploymentClient({
      resourceId,
      getToken: async () => 'token',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('provider details', { status: 403 })),
    });
    await expect(client.delete('deployment')).rejects.toThrow('Foundry model deployment request failed');
    await expect(client.delete('../unsafe')).rejects.toBeInstanceOf(ModelDeploymentError);
  });

  it('exposes the confirmed tool to chat and voice and the Dan-only routes', async () => {
    const baseWorkflow = workflowFixture();
    const notification = {
      notify: vi.fn(async () => {}),
      runConfirmed: vi.fn(async <T>(
        _kind: string,
        _summary: string,
        action: () => Promise<T>,
      ) => action()),
    } as unknown as TeamsNotificationService;
    const app = buildApp(config, undefined, {
      modules: [coreModule],
      auth: async () => owner,
      toolCallStore: { record: vi.fn(async () => {}) },
      modelDeploymentWorkflow: baseWorkflow.workflow,
      teamsNotifications: notification,
    });
    apps.push(app);

    const tools = await app.inject({ url: '/tools', headers });
    expect(tools.json()).toContainEqual(expect.objectContaining({ name: 'manage_model_deployment' }));
    const tool = await app.inject({
      method: 'POST',
      url: '/tools/manage_model_deployment',
      headers,
      payload: { action: 'create', model: 'gpt-5.6-luna', version: '2026-12-02', sku: 'GlobalStandard', capacity: 20 },
    });
    expect(tool.json()).toMatchObject({
      outcome: 'ok',
      result: { name: 'gpt-5.6-luna-2026-12-02', status: 'accepted' },
    });

    const route = await app.inject({
      method: 'POST',
      url: '/models/deployments',
      headers,
      payload: { model: 'gpt-5.6-luna', version: '2026-12-03', sku: 'GlobalStandard', capacity: 20 },
    });
    expect(route.statusCode).toBe(202);
    expect(route.json()).toEqual({ status: 'approval_pending', name: 'gpt-5.6-luna-2026-12-03' });

    const deletion = await app.inject({
      method: 'DELETE',
      url: '/models/deployments/custom-unused',
      headers,
    });
    expect(deletion.statusCode).toBe(202);
    expect(deletion.json()).toEqual({ status: 'approval_pending', name: 'custom-unused' });

    const denied = buildApp(config, undefined, {
      modules: [coreModule],
      auth: async () => ({ ...owner, objectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
      modelDeploymentWorkflow: baseWorkflow.workflow,
      teamsNotifications: notification,
    });
    apps.push(denied);
    const deniedResponse = await denied.inject({
      method: 'POST',
      url: '/models/deployments',
      headers,
      payload: { model: 'gpt-5.6-luna', version: '2026-12-04', sku: 'GlobalStandard', capacity: 20 },
    });
    expect(deniedResponse.statusCode).toBe(403);
    expect(baseWorkflow.confirm).toHaveBeenCalledWith(
      'model_deployment',
      expect.any(String),
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });
});
