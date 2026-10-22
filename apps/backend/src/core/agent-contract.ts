import { modelRoles, reasoningEfforts } from '@jarvis/contracts';
import {
  CAPABILITY_INSTRUCTIONS_MAX_CODE_POINTS,
} from './capability-instructions.js';
import {
  MAX_AGENT_TOOLS,
  MAX_CATALOGUE_BYTES,
  MAX_TOOL_DESCRIPTION_CHARACTERS,
} from './tool-registry.js';
import { identityContract } from './identity-composition.js';

interface AgentToolDescriptor {
  readonly name: unknown;
  readonly description: unknown;
  readonly inputSchema: unknown;
}

export interface AgentContractResult {
  readonly status: 'ok' | 'down';
  readonly reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string, allowWhitespace: boolean): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return code === 127 || (code < 32 && !(allowWhitespace && (code === 9 || code === 10 || code === 13)));
  });
}

function safeText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum &&
    !hasControlCharacters(value, true);
}

function validRoleSettings(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      typeof value.model !== 'string' || !value.model.trim() || value.model.length > 128) return false;
  return reasoningEfforts.includes(value.reasoningEffort as typeof reasoningEfforts[number]);
}

function validAgentSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const roles = value.roles;
  if (!isRecord(roles) || Object.keys(roles).length !== modelRoles.length ||
      modelRoles.some((role) => !validRoleSettings(roles[role]))) return false;

  const chat = roles.chat;
  if (!isRecord(chat)) return false;
  const model = chat.model;
  if (typeof model !== 'string' || !model.trim() || model.length > 100 ||
      hasControlCharacters(model, false) ||
      !reasoningEfforts.includes(chat.reasoningEffort as typeof reasoningEfforts[number])) return false;

  const mode = value.mode;
  if (!['present', 'away', 'on_the_move'].includes(mode as string) ||
      typeof value.awayMode !== 'boolean' || value.awayMode !== (mode !== 'present')) return false;
  if (value.changedAt !== null &&
      (typeof value.changedAt !== 'string' || value.changedAt.length > 100 ||
       hasControlCharacters(value.changedAt, false) || !Number.isFinite(Date.parse(value.changedAt)))) {
    return false;
  }

  const personality = value.personality;
  const modeInstructions = isRecord(personality) ? personality.modeInstructions : undefined;
  if (!isRecord(personality) ||
      !['british_butler', 'warm', 'direct', 'playful'].includes(personality.tone as string) ||
      !['concise', 'balanced', 'detailed'].includes(personality.responseStyle as string) ||
      !safeText(personality.customInstructions, 2_000) ||
      !isRecord(modeInstructions) ||
      Object.keys(modeInstructions).length !== 3 ||
      ['present', 'away', 'on_the_move'].some((key) =>
        !safeText(modeInstructions[key], 2_000))) return false;

  const identity = value.identity;
  if (identity !== undefined &&
      (!isRecord(identity) || Object.keys(identity).length !== 1 ||
       !safeText(identity.description, 2_000))) return false;
  if (value.identityContractVersion !== undefined &&
      value.identityContractVersion !== identityContract.version) return false;
  if (value.compositionRevision !== undefined &&
      (typeof value.compositionRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.compositionRevision))) return false;

  const timeouts = value.timeouts;
  if (!isRecord(timeouts) || Object.keys(timeouts).some((key) => ![
    'toolTimeoutSeconds', 'longToolTimeoutSeconds', 'backendHttpTimeoutSeconds',
  ].includes(key))) return false;
  const timeoutBounds: Readonly<Record<string, readonly [number, number]>> = {
    toolTimeoutSeconds: [1, 120],
    longToolTimeoutSeconds: [30, 320],
    backendHttpTimeoutSeconds: [1, 60],
  };
  const timeoutDefaults: Readonly<Record<string, number>> = {
    toolTimeoutSeconds: 30,
    longToolTimeoutSeconds: 320,
    backendHttpTimeoutSeconds: 10,
  };
  if (Object.entries(timeoutBounds).some(([key, [minimum, maximum]]) => {
    const timeout = timeouts[key] ?? timeoutDefaults[key];
    return !Number.isInteger(timeout) || (timeout as number) < minimum || (timeout as number) > maximum;
  })) return false;

  const research = value.research;
  if (!isRecord(research) || Object.keys(research).some((key) => key !== 'timeoutSeconds')) return false;
  const researchTimeout = research.timeoutSeconds ?? 305;
  if (!Number.isInteger(researchTimeout) || (researchTimeout as number) < 1 ||
      (researchTimeout as number) > 320) return false;

  const capabilityInstructions = value.capabilityInstructions;
  return typeof capabilityInstructions === 'string' &&
    Array.from(capabilityInstructions).length <= CAPABILITY_INSTRUCTIONS_MAX_CODE_POINTS &&
    safeText(capabilityInstructions, Number.MAX_SAFE_INTEGER);
}

function catalogueFailure(tools: readonly AgentToolDescriptor[]): string | undefined {
  if (!Array.isArray(tools) || tools.length > MAX_AGENT_TOOLS) return 'Tool count exceeds the agent limit.';
  const names = new Set<string>();
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.name !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(tool.name)) return 'A tool name is invalid.';
    if (names.has(tool.name)) return 'Tool names must be unique.';
    names.add(tool.name);
    if (typeof tool.description !== 'string' || !tool.description.trim()) {
      return 'A tool description is empty.';
    }
    if (Array.from(tool.description).length > MAX_TOOL_DESCRIPTION_CHARACTERS) {
      return 'A tool description exceeds the agent limit.';
    }
    if (!isRecord(tool.inputSchema) || tool.inputSchema.type !== 'object') {
      return 'A tool schema is not an object.';
    }
  }
  try {
    const bytes = Buffer.byteLength(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({
      name, description, inputSchema,
    }))));
    if (bytes > MAX_CATALOGUE_BYTES) return 'Tool catalogue exceeds the agent size limit.';
  } catch {
    return 'Tool catalogue cannot be serialized.';
  }
  return undefined;
}

export async function checkAgentContract(
  tools: readonly AgentToolDescriptor[],
  buildSettings: () => Promise<unknown>,
): Promise<AgentContractResult> {
  const failure = catalogueFailure(tools);
  if (failure) return { status: 'down', reason: failure };
  try {
    return validAgentSettings(await buildSettings())
      ? { status: 'ok' }
      : { status: 'down', reason: 'Agent settings have an invalid shape.' };
  } catch {
    return { status: 'down', reason: 'Agent settings could not be built.' };
  }
}
