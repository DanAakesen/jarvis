import type {
  SystemStatus,
  SystemStatusEntry,
  SystemStatusSubsystem,
  SystemStatusValue,
  SystemSmokeCheckId,
  SystemSmokeStatus,
} from '@jarvis/contracts';
import type { VaultIndexSummary } from './database/memory-store.js';
import { systemSmokeCheckIds, vaultMirrorStatusViewSchema } from '@jarvis/contracts';
import { z } from 'zod';

export type SystemStatusResult = Pick<SystemStatusEntry, 'status' | 'details'> & { reason?: string };

export type SystemStatusProbe = () => Promise<SystemStatusResult>;

export interface VaultIndexSyncEvidence {
  readonly outcome: 'pending' | 'ok' | 'error';
  readonly latestAttemptAt: string | null;
  readonly lastSuccessfulAt: string | null;
}

const vaultIndexStaleMs = 24 * 60 * 60_000;

export function assessVaultIndex(
  summary: VaultIndexSummary,
  sync: VaultIndexSyncEvidence,
  now = Date.now(),
): SystemStatusResult {
  const latestIndexedAt = summary.latestIndexedAt?.toISOString() ?? null;
  const successAt = sync.lastSuccessfulAt === null ? null : Date.parse(sync.lastSuccessfulAt);
  const syncFresh = successAt === null ? null :
    Number.isFinite(successAt) && successAt <= now && now - successAt <= vaultIndexStaleMs;
  const coveragePercent = summary.chunks === 0
    ? null
    : Math.round(summary.embeddedChunks / summary.chunks * 100);
  const status = sync.outcome === 'error' || syncFresh === false ? 'degraded' :
    syncFresh === null ? 'unknown' :
      summary.chunks === 0 ? 'unknown' :
        summary.embeddedChunks < summary.chunks ? 'degraded' : 'ok';
  return {
    status,
    details: {
      notes: summary.notes,
      chunks: summary.chunks,
      embeddedChunks: summary.embeddedChunks,
      embeddingCoveragePercent: coveragePercent,
      latestIndexedAt,
      latestSyncAttemptAt: sync.latestAttemptAt,
      lastSuccessfulSyncAt: sync.lastSuccessfulAt,
      syncOutcome: sync.outcome,
      syncFresh,
    },
  };
}

export interface SystemStatusProbes {
  readonly database?: SystemStatusProbe;
  readonly 'foundry.chat'?: SystemStatusProbe;
  readonly 'foundry.voice'?: SystemStatusProbe;
  readonly 'foundry.embeddings'?: SystemStatusProbe;
  readonly vault_index?: SystemStatusProbe;
  readonly github_app?: SystemStatusProbe;
  readonly google?: SystemStatusProbe;
  readonly pc_bridge?: SystemStatusProbe;
  readonly runner?: SystemStatusProbe;
}

export interface SystemStatusReader {
  read(): Promise<SystemStatus>;
  peek?(): SystemStatus | undefined;
  refresh(): Promise<SystemStatus>;
  recordError(route: string | undefined, statusCode: number): void;
  recordSmoke(report: SystemSmokeStatus): void;
}

export interface SystemSmokeReader {
  run(): Promise<SystemSmokeStatus>;
}

const subsystems: readonly SystemStatusSubsystem[] = [
  'database',
  'foundry.chat',
  'foundry.voice',
  'foundry.embeddings',
  'vault_index',
  'github_app',
  'google',
  'pc_bridge',
  'runner',
  'deployed_commit',
  'last_error',
];

const cacheTtlMs = 60_000;
export const researchSmokeFailureReasons: ReadonlySet<string> = new Set([
  'research_settings_unavailable',
  'research_runner_auth',
  'research_runner_timeout',
  'research_runner_aborted',
  'research_runner_transport',
  'research_runner_protocol',
  'research_runner_http_400',
  'research_runner_http_401',
  'research_runner_http_403',
  'research_runner_http_404',
  'research_runner_http_429',
  'research_runner_http_500',
  'research_runner_http_502',
  'research_runner_http_503',
  'research_runner_http_504',
  'research_usage_limit',
  'research_runner_failed',
  'research_result_missing',
  'research_result_invalid',
  'research_unavailable',
]);
export const chatAgentFailureReasons: ReadonlySet<string> = new Set([
  'backend_unavailable',
  'catalogue_unavailable',
  'context_unavailable',
  'usage_unavailable',
  'capability_instructions_too_large',
  'settings_not_json',
  'settings_invalid',
  'settings_timeout',
  'settings_unreachable',
  'settings_unavailable',
  'settings_http_401',
  'settings_http_403',
  'settings_http_429',
  'settings_http_500',
  'settings_http_502',
  'settings_http_503',
  'settings_http_504',
  'response_too_large',
  'error_runtimeerror',
  'error_valueerror',
  'error_typeerror',
  'error_timeouterror',
  'error_httpstatuserror',
  'error_connecterror',
  'error_readtimeout',
  'error_connecttimeout',
  'error_pooltimeout',
  'error_remoteprotocolerror',
  'error_ratelimiterror',
  'rate_limit_exceeded',
  'error_apistatuserror',
  'error_apiconnectionerror',
  'error_apitimeouterror',
  'error_authenticationerror',
  'error_permissiondeniederror',
  'error_badrequesterror',
  'model_bad_request_model',
  'model_bad_request_instructions',
  'model_bad_request_input',
  'model_bad_request_output_limit',
  'model_bad_request_storage',
  'model_bad_request_streaming',
  'model_bad_request_tools',
  'model_bad_request_reasoning',
  'model_bad_request_include',
  'model_reasoning_parameter_unsupported',
  'model_reasoning_effort_unsupported',
  'model_reasoning_value_unsupported',
  'model_reasoning_effort_value_unsupported',
  'model_reasoning_value_invalid',
  'model_reasoning_effort_value_invalid',
  'model_reasoning_request_invalid',
  'model_reasoning_effort_request_invalid',
  'error_internalservererror',
  'tool_loop_stalled',
  // Fixed internal managed runtime failures; never arbitrary provider codes.
  'managed_session_busy',
  'managed_source_already_claimed',
  'managed_target_mismatch',
  'managed_unavailable',
  'managed_agent_builtin_tools_enabled',
  'managed_agent_definition_mismatch',
  'managed_agent_definition_missing',
  'managed_agent_extra_skills',
  'managed_agent_function_tools_mismatch',
  'managed_agent_toolset_missing',
  'managed_agent_unsupported_setting',
  'managed_agent_version_mismatch',
  'managed_backend_endpoint_invalid',
  'managed_binding_invalid',
  'managed_binding_unavailable',
  'managed_claim_missing',
  'managed_client_retries_enabled',
  'managed_conversation_missing',
  'managed_definition_instructions_missing',
  'managed_definition_tools_invalid',
  'managed_endpoint_invalid',
  'managed_endpoint_selector_mismatch',
  'managed_existing_credential_unavailable',
  'managed_final_only_tool_call',
  'managed_immutable_target_missing',
  'managed_input_boundary_invalid',
  'managed_input_cursor_rewound',
  'managed_input_empty',
  'managed_input_item_unsupported',
  'managed_input_unsupported',
  'managed_limits_invalid',
  'managed_model_forbidden',
  'managed_model_unauthorized',
  'managed_policy_catalogue_changed',
  'managed_policy_image_unverified',
  'managed_policy_smoke_unavailable',
  'managed_policy_setup_failed',
  'managed_policy_turn_failed',
  'managed_probe_conversation_missing',
  'managed_probe_empty_or_unfinished',
  'managed_probe_failed',
  'managed_probe_incomplete',
  'managed_probe_requested_tool',
  'managed_probe_settings_mismatch',
  'managed_probe_timeout',
  'managed_project_endpoint_mismatch',
  'managed_provider_failure',
  'managed_readback_forbidden',
  'managed_readback_invalid',
  'managed_readback_unauthorized',
  'managed_readback_unavailable',
  'managed_response_empty',
  'managed_response_failed',
  'managed_response_item_unsupported',
  'managed_response_unfinished',
  'managed_reviewed_definition_mismatch',
  'managed_reviewed_fingerprint_mismatch',
  'managed_seed_input_invalid',
  'managed_source_context_missing',
  'managed_steering_source_unclaimed',
  'managed_summary_history_policy_pending',
  'managed_target_invalid',
  'managed_target_missing',
  'managed_target_settings_mismatch',
  'managed_tool_arguments_invalid',
  'managed_tool_call_invalid',
  'managed_tool_call_unfinished',
  'managed_tool_repeated',
  'managed_tool_round_limit',
  'managed_tool_schema_unsupported',
  'managed_turn_already_claimed',
  'managed_voice_requires_backend_relay',
]);
// Assigned by the backend itself while calling or reading the hosted agent; never copied from a payload.
export const chatAgentInvocationReasons: ReadonlySet<string> = new Set([
  'agent_auth_unavailable',
  'agent_request_failed',
  'agent_http_400',
  'agent_http_401',
  'agent_http_403',
  'agent_http_404',
  'agent_http_408',
  'agent_http_409',
  'agent_http_424',
  'agent_http_429',
  'agent_http_500',
  'agent_http_502',
  'agent_http_503',
  'agent_http_504',
  'agent_http_other',
  'agent_response_invalid',
  'agent_stream_failed',
  'agent_stream_ended',
  'agent_error_code_missing',
  'agent_error_code_unlisted',
]);
const sharedChatFailureReasons = [
  'agent_error', 'timeout', ...chatAgentFailureReasons, ...chatAgentInvocationReasons,
] as const;
const safeSmokeReasons: Partial<Record<SystemSmokeCheckId, ReadonlySet<string>>> = {
  research: researchSmokeFailureReasons,
  agent_contract: new Set([
    'Tool count exceeds the agent limit.',
    'A tool name is invalid.',
    'Tool names must be unique.',
    'A tool description is empty.',
    'A tool description exceeds the agent limit.',
    'A tool schema is not an object.',
    'Tool catalogue exceeds the agent size limit.',
    'Tool catalogue cannot be serialized.',
    'Agent settings have an invalid shape.',
    'Agent settings could not be built.',
    'Agent contract could not be checked.',
  ]),
  chat_canary: new Set(['acceptance_check_failed', 'agent_error', 'timeout', 'rate_limit_exceeded']),
  chat_identity: new Set(['catalogue_unavailable', 'identity_reply', ...sharedChatFailureReasons]),
  chat_capabilities: new Set([
    'catalogue_unavailable',
    'capabilities_discovery_missing',
    'capabilities_discovery_wrong',
    'capabilities_discovery_failed',
    'capabilities_receipt_incomplete',
    'capabilities_reply_incomplete',
    ...sharedChatFailureReasons,
  ]),
  chat_github_read: new Set(['catalogue_unavailable', 'github_issue_unavailable', ...sharedChatFailureReasons]),
  chat_jobs: new Set(['catalogue_unavailable', 'jobs_unavailable', ...sharedChatFailureReasons]),
  chat_navigation: new Set(['catalogue_unavailable', 'navigation_refusal_missing', ...sharedChatFailureReasons]),
  chat_no_timestamp: new Set(['catalogue_unavailable', 'capture_time_invented', ...sharedChatFailureReasons]),
  chat_plain_approval: new Set(['catalogue_unavailable', 'plain_approval_failed', ...sharedChatFailureReasons]),
};

export function safeSmokeReason(id: SystemSmokeCheckId, reason: unknown): string | undefined {
  return typeof reason === 'string' && reason.length <= 120 && safeSmokeReasons[id]?.has(reason)
    ? reason : undefined;
}

export function systemSmokeHttpResponse(report: SystemSmokeStatus): SystemSmokeStatus {
  return {
    ...report,
    entries: report.entries.map(({ reason, ...entry }) => ({
      ...entry,
      ...(entry.status === 'down' && reason !== undefined ? { reason } : {}),
    })),
  };
}

export const systemStatusResponseSchema = {
  type: 'object',
  properties: {
    vaultMirror: z.toJSONSchema(vaultMirrorStatusViewSchema),
    checkedAt: { type: 'string', format: 'date-time' },
    smoke: {
      type: 'object',
      properties: {
        checkedAt: { type: 'string', format: 'date-time' },
        entries: {
          type: 'array',
          minItems: systemSmokeCheckIds.length,
          maxItems: systemSmokeCheckIds.length,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', enum: systemSmokeCheckIds },
              status: { type: 'string', enum: ['ok', 'degraded', 'down', 'unknown'] },
              checkedAt: { type: 'string', format: 'date-time' },
              reason: { type: 'string', minLength: 1, maxLength: 120 },
            },
            required: ['id', 'status', 'checkedAt'],
            additionalProperties: false,
          },
        },
      },
      required: ['checkedAt', 'entries'],
      additionalProperties: false,
    },
    entries: {
      type: 'array',
      minItems: subsystems.length,
      maxItems: subsystems.length,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: subsystems },
          status: { type: 'string', enum: ['ok', 'degraded', 'down', 'unknown'] },
          checkedAt: { type: 'string', format: 'date-time' },
          details: {
            type: 'object',
            additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
          },
        },
        required: ['id', 'status', 'checkedAt'],
        additionalProperties: false,
      },
    },
  },
  required: ['checkedAt', 'entries'],
  additionalProperties: false,
} as const;

export const systemSmokeResponseSchema = {
type: 'object',
properties: {
  checkedAt: { type: 'string', format: 'date-time' },
  entries: {
    type: 'array',
    minItems: systemSmokeCheckIds.length,
    maxItems: systemSmokeCheckIds.length,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', enum: systemSmokeCheckIds },
        status: { type: 'string', enum: ['ok', 'degraded', 'down', 'unknown'] },
        checkedAt: { type: 'string', format: 'date-time' },
        reason: { type: 'string', minLength: 1, maxLength: 120 },
      },
      required: ['id', 'status', 'checkedAt'],
      additionalProperties: false,
    },
  },
},
required: ['checkedAt', 'entries'],
additionalProperties: false,
} as const;

function isStatus(value: unknown): value is SystemStatusValue {
  return value === 'ok' || value === 'degraded' || value === 'down' || value === 'unknown';
}

export function createSystemStatusReader(
  probes: SystemStatusProbes,
  deployedCommit: string | undefined,
  now: () => number = Date.now,
  ttlMs = cacheTtlMs,
): SystemStatusReader {
  let cached: { expiresAt: number; value: SystemStatus } | undefined;
  let pending: Promise<SystemStatus> | undefined;
  let lastError: { occurredAt: string; route: string | null; statusCode: number } | undefined;
  let latestSmoke: SystemSmokeStatus | undefined;
  let latest: SystemStatus | undefined;

  const readProbe = async (id: SystemStatusSubsystem): Promise<SystemStatusEntry> => {
    const checkedAt = new Date(now()).toISOString();
    if (id === 'deployed_commit') {
      return {
        id,
        checkedAt,
        status: deployedCommit ? 'ok' : 'unknown',
        details: { commit: deployedCommit ?? null },
      };
    }
    if (id === 'last_error') {
      return {
        id,
        checkedAt,
        status: lastError ? 'degraded' : 'ok',
        details: lastError
          ? { occurredAt: lastError.occurredAt, route: lastError.route, statusCode: lastError.statusCode }
          : { occurredAt: null, route: null, statusCode: null },
      };
    }

    const probe = probes[id];
    if (!probe) return { id, checkedAt, status: 'unknown', details: { configured: false } };
    try {
      const result = await probe();
      return {
        id,
        checkedAt,
        status: isStatus(result.status) ? result.status : 'unknown',
        ...(result.details ? { details: result.details } : {}),
      };
    } catch {
      return { id, checkedAt, status: 'down', details: { reason: 'check_failed' } };
    }
  };

  return {
    peek() {
      return latest ? {
        ...latest,
        ...(latestSmoke ? { smoke: latestSmoke } : {}),
        entries: latest.entries.map((entry) => entry.id === 'last_error' && lastError
          ? { id: entry.id, status: 'degraded', checkedAt: lastError.occurredAt,
            details: { statusCode: lastError.statusCode } }
          : entry),
      } : latestSmoke ? { checkedAt: latestSmoke.checkedAt, entries: [], smoke: latestSmoke } : undefined;
    },
    async read() {
      const timestamp = now();
      if (cached && timestamp < cached.expiresAt) return cached.value;
      if (pending) return pending;
      pending = Promise.all(subsystems.map(readProbe)).then((entries) => {
        const value: SystemStatus = {
          checkedAt: new Date(timestamp).toISOString(),
          entries,
          ...(latestSmoke ? { smoke: latestSmoke } : {}),
        };
        cached = { expiresAt: timestamp + ttlMs, value };
        latest = value;
        return value;
      }).finally(() => { pending = undefined; });
      return pending;
    },
    refresh() {
      cached = undefined;
      return this.read();
    },
    recordError(route, statusCode) {
      if (!Number.isInteger(statusCode) || statusCode < 500 || statusCode > 599) return;
      const safeRoute = typeof route === 'string' && route.startsWith('/') &&
        !route.includes('?') && !route.includes('#') &&
        !Array.from(route).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
        ? route.slice(0, 128)
        : null;
      lastError = { occurredAt: new Date(now()).toISOString(), route: safeRoute, statusCode };
      cached = undefined;
    },
    recordSmoke(report) {
      latestSmoke = report;
      if (cached) cached.value = { ...cached.value, smoke: report };
    },
  };
}

export function createSystemSmokeReader(
  status: SystemStatusReader,
  probes: Partial<Record<SystemSmokeCheckId, SystemStatusProbe>>,
  now: () => number = Date.now,
): SystemSmokeReader {
  const sourceFor: Readonly<Partial<Record<SystemSmokeCheckId, SystemStatusSubsystem>>> = {
    google: 'google',
    github_app: 'github_app',
    'foundry.embeddings': 'foundry.embeddings',
    pc_bridge: 'pc_bridge',
  };
  return {
    async run() {
      const [snapshot, probeResults] = await Promise.all([
        status.refresh(),
        Promise.all(Object.entries(probes).map(async ([id, probe]) => {
          try {
            return [id, await probe!()] as const;
          } catch {
            return [id, { status: 'down' as const }] as const;
          }
        })),
      ]);
      const activeChecks = new Map(probeResults);
      const sourceEntries = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
      const researchCheckedAt = new Date(now()).toISOString();
      const entries = systemSmokeCheckIds.map((id) => {
        const active = activeChecks.get(id);
        const source = sourceFor[id] ? sourceEntries.get(sourceFor[id]!) : undefined;
        if (active) {
          const reason = active.status === 'down' || active.status === 'degraded'
            ? safeSmokeReason(id, active.reason)
            : undefined;
          return {
            id,
            status: isStatus(active.status) ? active.status : 'unknown',
            checkedAt: researchCheckedAt,
            ...(reason ? { reason } : {}),
          };
        }
        return {
          id,
          status: source?.status ?? 'unknown',
          checkedAt: source?.checkedAt ?? researchCheckedAt,
        };
      });
      const report: SystemSmokeStatus = { checkedAt: new Date(now()).toISOString(), entries };
      status.recordSmoke(report);
      return report;
    },
  };
}

export function summarizeSystemStatus(status: SystemStatus): string {
  const counts = { ok: 0, degraded: 0, down: 0, unknown: 0 };
  for (const { id, status: value } of status.entries) {
    if (id !== 'last_error' && isStatus(value)) counts[value] += 1;
  }
  return `System status: ${counts.ok} ok, ${counts.degraded} degraded, ${counts.down} down, ${counts.unknown} unknown.`;
}
