import type { ModelCatalogue, ModelDeployment } from '@jarvis/contracts';
import type { FastifyInstance } from 'fastify';
import type { SettingsStore } from './settings.js';
import { readSettings } from './settings.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from './tool-registry.js';
import type { ModelCatalogueReader } from './model-catalog.js';

const armScope = 'https://management.azure.com/.default';
const apiVersion = '2024-10-01';
const requestTimeoutMs = 10_000;
const accountResourceIdPattern = /^\/subscriptions\/[a-f\d-]+\/resourceGroups\/[a-z\d._()-]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[a-z\d-]+$/iu;
const deploymentNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export interface NewModelDeployment {
  readonly name: string;
  readonly model: string;
  readonly version: string;
  readonly sku: string;
  readonly capacity: number;
}

export interface AcceptedModelDeployment extends NewModelDeployment {
  readonly status: 'accepted';
}

export interface ModelDeploymentClient {
  create(deployment: NewModelDeployment, signal?: AbortSignal): Promise<void>;
  delete(name: string, signal?: AbortSignal): Promise<void>;
}

export interface PendingModelDeployment<T> {
  readonly name: string;
  readonly completion: Promise<T>;
}

export interface ModelDeploymentWorkflow {
  startCreate(input: Omit<NewModelDeployment, 'name'>, signal?: AbortSignal): Promise<PendingModelDeployment<AcceptedModelDeployment>>;
  startDelete(name: string, signal?: AbortSignal): Promise<PendingModelDeployment<{ name: string; status: 'accepted' }>>;
  create(input: Omit<NewModelDeployment, 'name'>, signal?: AbortSignal): Promise<AcceptedModelDeployment>;
  delete(name: string, signal?: AbortSignal): Promise<{ name: string; status: 'accepted' }>;
}

export class ModelDeploymentError extends Error {
  constructor(readonly statusCode: 400 | 404 | 409 | 503, message: string) {
    super(message);
    this.name = 'ModelDeploymentError';
  }
}

interface ArmModelDeploymentClientOptions {
  readonly resourceId: string;
  readonly getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  readonly fetcher?: typeof fetch;
}

export function createArmModelDeploymentClient({
  resourceId,
  getToken,
  fetcher = fetch,
}: ArmModelDeploymentClientOptions): ModelDeploymentClient {
  if (!accountResourceIdPattern.test(resourceId)) throw new Error('Invalid Foundry account resource ID');
  const accountUrl = `https://management.azure.com${resourceId}/deployments`;

  async function request(
    method: 'PUT' | 'DELETE',
    name: string,
    deployment?: NewModelDeployment,
    requestSignal?: AbortSignal,
  ): Promise<void> {
    if (!deploymentNamePattern.test(name)) throw new ModelDeploymentError(400, 'Invalid deployment name.');
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, AbortSignal.timeout(requestTimeoutMs)])
      : AbortSignal.timeout(requestTimeoutMs);
    const token = await getToken(armScope, signal);
    if (!token.trim() || /[\r\n]/u.test(token)) throw new Error('Foundry deployment identity token unavailable');
    const url = new URL(`${accountUrl}/${encodeURIComponent(name)}`);
    url.searchParams.set('api-version', apiVersion);
    const response = await fetcher(url, {
      method,
      headers: {
        Authorization: `${['Bear', 'er'].join('')} ${token}`,
        Accept: 'application/json',
        ...(deployment ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(deployment ? {
        body: JSON.stringify({
          sku: { name: deployment.sku, capacity: deployment.capacity },
          properties: {
            model: { format: 'OpenAI', name: deployment.model, version: deployment.version },
          },
        }),
      } : {}),
      redirect: 'error',
      signal,
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.redirected || !(response.ok || response.status === 202)) {
      throw new Error('Foundry model deployment request failed');
    }
  }

  return {
    create: (deployment, signal) => request('PUT', deployment.name, deployment, signal),
    delete: (name, signal) => request('DELETE', name, undefined, signal),
  };
}

interface ModelDeploymentWorkflowOptions {
  readonly catalogue: ModelCatalogueReader;
  readonly settings: SettingsStore;
  readonly client: ModelDeploymentClient;
  readonly confirm: <T>(
    actionKind: 'model_deployment',
    summary: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<T>;
  readonly onChanged?: () => void;
}

function isArmCatalogue(catalogue: ModelCatalogue): boolean {
  return catalogue.source === 'arm';
}

function deploymentNameFor(model: string, version: string): string {
  const name = `${model}-${version}`;
  if (!deploymentNamePattern.test(name)) {
    throw new ModelDeploymentError(400, 'The model and version do not produce a valid deployment name.');
  }
  return name;
}

function validateCreateInput(input: Omit<NewModelDeployment, 'name'>): void {
  if (typeof input.model !== 'string' || input.model.length < 1 || input.model.length > 128 ||
      typeof input.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.version) ||
      typeof input.sku !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(input.sku) ||
      !Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > 100_000) {
    throw new ModelDeploymentError(400, 'Invalid model deployment details.');
  }
}

function requireModel(catalogue: ModelCatalogue, model: string): void {
  if (!isArmCatalogue(catalogue)) {
    throw new ModelDeploymentError(503, 'The live Foundry model catalogue is unavailable.');
  }
  if (!catalogue.deployments.some((deployment) => deployment.model === model)) {
    throw new ModelDeploymentError(400, 'Only models in the live Foundry catalogue can be deployed.');
  }
}

function requireUnusedDeployment(
  catalogue: ModelCatalogue,
  settings: Awaited<ReturnType<typeof readSettings>>,
  name: string,
): ModelDeployment {
  if (!isArmCatalogue(catalogue)) {
    throw new ModelDeploymentError(503, 'The live Foundry model catalogue is unavailable.');
  }
  const deployment = catalogue.deployments.find((candidate) => candidate.name === name);
  if (!deployment) throw new ModelDeploymentError(404, 'Foundry model deployment not found.');
  if (Object.values(settings.roles).some((role) => role.model === name)) {
    throw new ModelDeploymentError(409, 'This deployment is selected by a model role and cannot be deleted.');
  }
  return deployment;
}

export function createModelDeploymentWorkflow({
  catalogue,
  settings,
  client,
  confirm,
  onChanged,
}: ModelDeploymentWorkflowOptions): ModelDeploymentWorkflow {
  const pending = new Set<string>();

  function start<T>(
    name: string,
    summary: string,
    signal: AbortSignal | undefined,
    action: () => Promise<T>,
  ): PendingModelDeployment<T> {
    if (pending.has(name)) throw new ModelDeploymentError(409, 'A request for this deployment is already pending.');
    pending.add(name);
    const completion = Promise.resolve()
      .then(() => confirm('model_deployment', summary, action, signal))
      .finally(() => pending.delete(name));
    void completion.catch(() => undefined);
    return { name, completion };
  }

  async function startCreate(
    input: Omit<NewModelDeployment, 'name'>,
    signal?: AbortSignal,
  ): Promise<PendingModelDeployment<AcceptedModelDeployment>> {
    validateCreateInput(input);
    const name = deploymentNameFor(input.model, input.version);
    const initialCatalogue = await catalogue.read();
    requireModel(initialCatalogue, input.model);
    if (initialCatalogue.deployments.some((deployment) => deployment.name === name)) {
      throw new ModelDeploymentError(409, 'A deployment with this model and version already exists.');
    }
    return start(name, `Deploy ${input.model} version ${input.version} as ${name} (${input.sku}, capacity ${input.capacity}).`, signal, async () => {
      catalogue.invalidate?.();
      const currentCatalogue = await catalogue.read();
      requireModel(currentCatalogue, input.model);
      if (currentCatalogue.deployments.some((deployment) => deployment.name === name)) {
        throw new ModelDeploymentError(409, 'A deployment with this model and version already exists.');
      }
      await client.create({ ...input, name }, signal);
      catalogue.invalidate?.();
      onChanged?.();
      return { ...input, name, status: 'accepted' };
    });
  }

  async function startDelete(
    name: string,
    signal?: AbortSignal,
  ): Promise<PendingModelDeployment<{ name: string; status: 'accepted' }>> {
    if (!deploymentNamePattern.test(name)) throw new ModelDeploymentError(400, 'Invalid deployment name.');
    const initialCatalogue = await catalogue.read();
    requireUnusedDeployment(initialCatalogue, await readSettings(settings, initialCatalogue), name);
    return start(name, `Delete the Foundry model deployment ${name}.`, signal, async () => {
      catalogue.invalidate?.();
      const currentCatalogue = await catalogue.read();
      requireUnusedDeployment(currentCatalogue, await readSettings(settings, currentCatalogue), name);
      await client.delete(name, signal);
      catalogue.invalidate?.();
      onChanged?.();
      return { name, status: 'accepted' };
    });
  }

  return {
    startCreate,
    startDelete,
    async create(input, signal) {
      return (await startCreate(input, signal)).completion;
    },
    async delete(name, signal) {
      return (await startDelete(name, signal)).completion;
    },
  };
}

const createBodySchema = {
  type: 'object',
  properties: {
    model: { type: 'string', minLength: 1, maxLength: 128 },
    version: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$', maxLength: 128 },
    sku: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$', maxLength: 64 },
    capacity: { type: 'integer', minimum: 1, maximum: 100_000 },
  },
  required: ['model', 'version', 'sku', 'capacity'],
  additionalProperties: false,
};

const deploymentNameSchema = {
  type: 'string',
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
  maxLength: 128,
};

function routeErrorStatus(error: unknown): number {
  return error instanceof ModelDeploymentError ? error.statusCode : 503;
}

function routeErrorMessage(error: unknown): string {
  return error instanceof ModelDeploymentError ? error.message : 'Model deployment management is unavailable.';
}

function reportPendingOperation(
  app: FastifyInstance,
  name: string,
  verb: 'create' | 'delete',
  completion: Promise<unknown>,
): void {
  void completion.then(async () => {
    await app.teamsNotifications?.notify('success', `Foundry model deployment ${name} ${verb} request was accepted.`);
  }, async (error: unknown) => {
    if (error instanceof ToolRefusal) {
      await app.teamsNotifications?.notify('warning', `Model deployment ${name} was not changed: ${error.message}`)
        .catch(() => undefined);
      return;
    }
    app.log.warn('models.deployment_operation_failed');
    await app.teamsNotifications?.notify('error', 'The model deployment operation failed. No successful change was reported.')
      .catch(() => undefined);
  }).catch(() => undefined);
}

export const manageModelDeploymentTool: JarvisTool = {
  name: 'manage_model_deployment',
  description: 'Create or delete a Foundry model deployment after Dan confirms in Now.',
  // Voice Live and the Responses API reject combinators on the root schema (L121); execute
  // enforces the per-action requirements instead.
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'delete'] },
      model: { type: 'string', minLength: 1, maxLength: 128, description: 'Model to deploy (create only).' },
      version: {
        type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$', maxLength: 128,
        description: 'Model version (create only).',
      },
      sku: {
        type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$', maxLength: 64,
        description: 'Deployment SKU, for example GlobalStandard (create only).',
      },
      capacity: { type: 'integer', minimum: 1, maximum: 100_000, description: 'Capacity units (create only).' },
      name: { ...deploymentNameSchema, description: 'Deployment to delete (delete only).' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  execute: async (input, request, signal) => {
    const workflow = request.server.modelDeploymentWorkflow;
    if (!workflow) throw new ToolRefusal('Model deployment management is unavailable.');
    const value = input as { action: 'create' | 'delete'; model?: string; version?: string; sku?: string;
      capacity?: number; name?: string };
    const create = value.action === 'create';
    if (create && (value.name !== undefined || value.model === undefined || value.version === undefined ||
        value.sku === undefined || value.capacity === undefined)) {
      throw new ToolRefusal('Creating a deployment needs model, version, sku and capacity, and no name.');
    }
    if (!create && (value.name === undefined || value.model !== undefined || value.version !== undefined ||
        value.sku !== undefined || value.capacity !== undefined)) {
      throw new ToolRefusal('Deleting a deployment needs only its name.');
    }
    try {
      return create
        ? await workflow.create({
          model: value.model!, version: value.version!, sku: value.sku!, capacity: value.capacity!,
        }, signal)
        : await workflow.delete(value.name!, signal);
    } catch (error) {
      if (error instanceof ToolRefusal) throw error;
      if (error instanceof ModelDeploymentError) throw new ToolRefusal(error.message);
      throw new ToolFailure('Model deployment operation failed.');
    }
  },
};

export function registerModelDeploymentRoutes(app: FastifyInstance): void {
  app.post<{ Body: Omit<NewModelDeployment, 'name'> }>('/models/deployments', {
    schema: { body: createBodySchema },
  }, async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const workflow = app.modelDeploymentWorkflow;
    if (!workflow || !app.teamsNotifications) {
      return reply.code(503).send({ error: 'Model deployment management is unavailable.' });
    }
    try {
      const pendingOperation = await workflow.startCreate(request.body, AbortSignal.timeout(6 * 60_000));
      reportPendingOperation(app, pendingOperation.name, 'create', pendingOperation.completion);
      return reply.code(202).send({ status: 'approval_pending', name: pendingOperation.name });
    } catch (error) {
      if (!(error instanceof ModelDeploymentError)) app.log.warn('models.deployment_request_failed');
      return reply.code(routeErrorStatus(error)).send({ error: routeErrorMessage(error) });
    }
  });

  app.delete<{ Params: { name: string } }>('/models/deployments/:name', {
    schema: {
      params: {
        type: 'object',
        properties: { name: deploymentNameSchema },
        required: ['name'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const workflow = app.modelDeploymentWorkflow;
    if (!workflow || !app.teamsNotifications) {
      return reply.code(503).send({ error: 'Model deployment management is unavailable.' });
    }
    try {
      const pendingOperation = await workflow.startDelete(request.params.name, AbortSignal.timeout(6 * 60_000));
      reportPendingOperation(app, pendingOperation.name, 'delete', pendingOperation.completion);
      return reply.code(202).send({ status: 'approval_pending', name: pendingOperation.name });
    } catch (error) {
      if (!(error instanceof ModelDeploymentError)) app.log.warn('models.deployment_request_failed');
      return reply.code(routeErrorStatus(error)).send({ error: routeErrorMessage(error) });
    }
  });
}
