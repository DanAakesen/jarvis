import { Writable } from 'node:stream';
import pino from 'pino';
import type { Contracts } from 'applicationinsights';
import type { BackendConfig } from './config.js';
import { systemSmokeCheckIds } from '@jarvis/contracts';
import { safeSmokeReason } from './system-status.js';
import { sanitizeManagedProviderCause } from './managed-provider-cause.js';
import { voiceStages, voiceTimeoutStages, voiceEventTypes } from './voice/diagnostics.js';
import { brainLogReasons, brainTickOutcomes } from './pi/brain/outcomes.js';
import { safeRateLimitMessages } from './pi/rate-limit.js';
import { allTurnKinds } from './pi/store.js';

// This is the external export boundary, replaced by an offline sink in tests.
export interface TelemetrySink {
  trackTrace(trace: Contracts.TraceTelemetry): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export async function createTelemetry(connectionString?: string): Promise<TelemetrySink | undefined> {
  if (connectionString === undefined) return undefined;
  const { TelemetryClient } = await import('applicationinsights');
  const client = new TelemetryClient(connectionString, { useGlobalProviders: false });
  client.config.enableUseDiskRetryCaching = false;
  client.initialize();
  return client;
}

const failureEvents = new Set([
  'proactive.failed', 'proactive.model_failed', 'image_generation.failed',
  'proactive.todo_writer',
  'daily.gym_log',
  'Background job visibility read failed', 'Background job dismissal failed', 'Background job dismissal import failed',
  'daily.mcp_operation_failed', 'daily.mcp_audit_failed', 'tool.audit_failed',
  'sandbox_heartbeat.poll_failed', 'sandbox_heartbeat.configuration_missing', 'factory_worker.mailbox_failed',
  'budget_alert.check_failed', 'task_event_archive.failed', 'project_policy.confirmation_failed',
  'project_policy.recheck_failed',
  'dispatcher.operation_failed', 'github.checks_loop_recovery_failed', 'pc_bridge.status_update_failed',
  'google.refresh_token_expired_alert_unavailable', 'google.refresh_token_expired_alert_persistence_failed',
  'google.calendar_batch_item_failed',
  'daily.health_processing_retry',
  'telemetry.close_failed', 'server.shutdown_failed', 'request.failed', 'connection.upgrade_failed',
  'attachment.extraction_failed', 'away_mode.task_notification_failed', 'away_mode.task_route_failed',
  'codex.image_cancel_failed', 'codex.image_session_cleanup_failed', 'conversation_attachments.cleanup_failed',
  'conversation_summary.read_failed', 'conversation_summary.save_failed',
  'credentials.codex_renewal_failed', 'credentials.copilot_check_failed', 'credentials.github_app_status_failed',
  'factory.board_project_lookup_failed', 'factory.board_read_failed', 'factory.board_task_event_failed',
  'voice.settings_refresh_failed', 'voice.identity_settings_unavailable',
  'factory.board_webhook_update_failed', 'factory.issue_backfill_failed', 'factory.issue_create_failed',
  'factory.issue_executor_handoff_failed', 'factory.release_data_read_failed', 'factory.release_graph_read_failed',
  'factory.task_submission_claim_failed', 'factory.linked_task_create_failed', 'factory.task_submission_result_failed',
  'factory.release_project_lookup_failed', 'folio.delete_failed', 'folio.open_failed',
  'folio.research_result_open_failed', 'folio.job_result_open_failed', 'folio.search_failed',
  'activitykit.push_not_accepted', 'activitykit.push_unavailable', 'activitykit.snapshot_unavailable',
  'activitykit.push_retry_exhausted', 'activitykit.registration_unavailable',
  'approval_notification.push_not_accepted', 'approval_notification.push_unavailable',
  'approval_notification.delivery_unavailable', 'approval_notification.registration_unavailable',
  'approval_notification.persistence_unavailable', 'approval_notification.reconciliation_timeout',
  'approval_notification.accepted_outcome_unavailable',
  'reply_notification.delivery_unavailable',
  'reply_notification.delivery_outcome', 'reply_notification.persistence_unavailable',
  'folio.update_failed', 'github.delivery_policy_evaluation_failed', 'github.installation_token_failed',
  'github.issue_progress_failed', 'github.issue_start_failed', 'github.repository_list_failed',
  'github.repository_management_failed', 'github.webhook_delivery_store_failed', 'github.webhook_mapping_failed',
  'github.webhook_secret_unavailable', 'github.webhook_signature_invalid', 'github.webhook_workflow_unavailable',
  'memory.embedding_backfill_failed', 'memory.vault_forget_failed', 'models.deployment_operation_failed',
  'models.deployment_request_failed', 'phone.call_answer_failed', 'phone.call_callback_processing_failed',
  'phone.call_cleanup_failed', 'phone.call_media_cleanup_failed', 'phone.call_shutdown_cleanup_failed',
  'phone.incoming_call_processing_failed', 'phone.status_unavailable', 'phone.transcript_persistence_failed',
  'phone.voice_connection_failed', 'task_status_notification.failed', 'usage.codex_tool_counts_unavailable',
  'usage.embedding_tokens_unavailable', 'voice.away_mode_settings_unavailable', 'voice.memory_settings_unavailable',
  'voice.partial_reflex_failed', 'voice.personality_settings_unavailable', 'voice.presence_mode_update_failed',
  'voice.session_persistence_failed', 'voice.transcript_persistence_failed',
  'health_host_shutdown_failed', 'health_host_configuration_or_startup_failed',
  'workspace_artifact.html_open_url_failed', 'workspace_artifact.html_pin_failed',
  'calendar.events_failed', 'workspace_artifact.html_read_failed', 'workspace_artifact.image_read_failed',
  'workspace_artifact.image_upload_failed', 'workspace_pins.list_failed', 'workspace_pins.pin_failed',
  'workspace_pins.unpin_failed',
]);
const errorKinds = new Set(['http', 'auth', 'timeout', 'aborted', 'transport', 'protocol', 'internal']);

/** The class of a thrown value, for diagnostics: a code identifier such as `RequestError` or `TypeError`, never its message. */
export function errorClassName(error: unknown): string {
  const name = error instanceof Error
    ? error.constructor.name
    : error === null ? 'null' : typeof error === 'object' ? 'Object' : typeof error;
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name) ? name : 'Error';
}

export function safeErrorFields(error: unknown): { kind: string; statusCode?: number } {
  const details = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {};
  const kind = typeof details.kind === 'string' && errorKinds.has(details.kind)
    ? details.kind
    : details.name === 'TimeoutError' ? 'timeout' : details.name === 'AbortError' ? 'aborted' : 'internal';
  const statusCode = details.statusCode ?? details.status;
  return {
    kind,
    ...(typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
      ? { statusCode } : {}),
  };
}

const ownerSessionEvents = new Set([
  'owner_session.created', 'owner_session.revoked', 'owner_session.rejected', 'owner_session.refresh_failed',
  'owner_session.boot_revoke',
]);

const events = new Set([
  ...failureEvents,
  'request.started', 'request.completed', 'request.origin_denied', 'request.auth_denied',
  ...ownerSessionEvents,
  'server.listening', 'server.stopping', 'server.stopped', 'server.failed',
  'database.ready', 'database.not_configured',
  'telemetry.stdout_only', 'telemetry.export_failed',
  'sandbox_heartbeat.decision', 'task_reconciliation.decision', 'voice.reflex_metrics',
  'voice.partials_unavailable', 'chat.latency', 'chat.agent_session', 'memory.embedding', 'vault.index', 'vault.write',
  'inbox.write', 'inbox.tool', 'inbox.index_unavailable', 'inbox.triage', 'inbox.nudge',
  'pc_act.step',
  'reflex.decision',
  'voice.proactive_context_unavailable', 'voice.credential_refresh_failed',
  'vision.watch', 'visual.path',
  'conversation.reply_failed', 'voice.connection_failed', 'voice.upstream_closed', 'voice.upstream_error',
  'voice.upstream_event_error', 'voice.turn_timing', 'voice.pi_turn', 'pi.turn', 'pi.budget_unreadable',
  'pi.stream_failed', 'pi.stream_retry', 'pi.harness_item', 'pi.mcp_list_failed', 'pi.mcp_call_failed', 'pi.mcp_tool',
  'pi.brain', 'pi.brain_tick', 'pi.brain_state', 'pi.brain_run',
  'pi.turn_record_failed', 'pi.usage_record_failed', 'pi.mark_warm_failed', 'pi.situation_stale_failed', 'pi.conversation_cleanup_failed',
  'pi.smoke_failed', 'pi.watches',
  'weather.phase',
  'pc_bridge.command_timing', 'pc_bridge.wake_word',
  'voice.session_stage', 'voice.stage_timeout', 'voice.session_summary', 'voice.late_session_ended',
  'voice.late_session_cleanup_failed', 'watch_transcription.stage',
  'voice.tool_budget_attempt', 'voice.tool_budget_selected', 'voice.tool_budget_exhausted',
  'voice.tool_budget_probe',
  'voice.delegation_received', 'voice.owner_group_persisted', 'voice.did_not_catch', 'voice.pi_turn_started',
  'voice.activity_published',
  'credentials.codex_renewal', 'dispatcher.start_failed',
  'tool.invalid_arguments', 'tool.execution_failed', 'decision.provider_unavailable', 'approval.interpreted',
  'factory.issue_create_outcome_uncertain',
  'factory.board_phase', 'factory.board_read_timing', 'factory.board_invalidated',
  'system.smoke_check',
  'proactive.reminder_plan', 'proactive.reminder_tick', 'proactive.alert',
  'proactive.events', 'proactive.events_disabled', 'proactive.event_model_failed', 'proactive.event_producer',
  'proactive.event_source',
  'phone.call_callback_processed', 'phone.incoming_call_rejected', 'phone.session_started',
]);

export function isRegisteredLogEvent(event: string): boolean {
  return events.has(event);
}

/**
 * Historical logs are untrusted. Reuse the export allowlist, then omit free text and identifiers. The exception is an
 * activation's id: a server-generated UUID that ties a wake to its ledger turn.
 */
export function safeHistoricalLogFields(input: Record<string, unknown>): Record<string, unknown> {
  const categories = new Set([
    'kind', 'method', 'reason', 'phase', 'stage', 'lastStage', 'outcome', 'decision', 'status',
    'language', 'scope', 'source', 'channel', 'closedBy', 'family', 'verdict', 'cachePath',
    'sessionStartType', 'part', 'provider', 'intent', 'confidence', 'command', 'action',
    'errorCode', 'errorType', 'param', 'state', 'rung', 'toolBudgetRung', 'probe', 'folder', 'fallbackReason',
    'event', 'code', 'server', 'tool', 'azureCatalogue', 'providerMessage',
    'errorClass', 'trigger', 'activationType', 'activationSource', 'activationId', 'classes',
  ]);
  return Object.fromEntries(Object.entries(safeFields(input)).filter(([key, value]) =>
    typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && categories.has(key))));
}

// Apply an allowlist before either stdout or Application Insights sees a record.
// Headers, bodies, URLs, query strings, arbitrary messages and errors are discarded.
const authDenialReasons = new Set([
  'missing_token', 'malformed_authorization', 'duplicate_authorization', 'invalid_token', 'principal_not_allowed_on_route',
]);
// Why an owner session request was refused; mirrors ownerSessionAuditReasons in auth/session/audit.ts.
const ownerSessionReasons = new Set([
  'disabled', 'malformed', 'unknown_session', 'secret_mismatch', 'revoked', 'idle_expired', 'absolute_expired',
  'owner_mismatch', 'store_unavailable', 'throttled', 'rate_limited', 'forbidden',
]);
const heartbeatDecisions = new Set([
  'queued', 'running', 'completed', 'crashed', 'idle_expired', 'needs_attention',
  'paused', 'pause_unchanged', 'cancelled', 'cancelling', 'interrupted', 'unknown',
  'unchanged', 'confirm_failure', 'persistence_failed', 'poll_failed',
]);
const reconciliationStatuses = new Set([
  'queued', 'running', 'completed', 'failed', 'cancelled', 'needs_attention', 'cancelling', 'interrupted',
  'paused', 'unknown', 'unavailable', 'Ready', 'Running', 'PauseRequested', 'Paused', 'NeedsAttention',
  'Done', 'Cancelled', 'task_missing',
]);
const reconciliationDecisions = new Set([
  'reconciliation_failed', 'runner_alive', 'needs_attention', 'unchanged', 'done', 'task_missing',
  'runner_status_unavailable', 'runner_session_mismatch', 'ended_session_still_running',
  'completed_without_verified_delivery', 'foundry_queued', 'foundry_running', 'foundry_completed',
  'foundry_failed', 'foundry_cancelled', 'foundry_needs_attention', 'foundry_cancelling',
  'foundry_interrupted', 'foundry_paused', 'foundry_unknown',
  'Ready', 'Running', 'PauseRequested', 'Paused', 'NeedsAttention', 'Done', 'Cancelled',
]);
const chatLatencyPhases = new Set([
  'reflex_targets', 'jev', 'agent_first_byte', 'turn_first_token', 'turn_complete',
  'recipe_select', 'recipe_verify', 'recipe_plan', 'recipe_run',
  'chat_history_verification', 'chat_context', 'tool_catalogue', 'settings',
  'turn_context', 'prompt_build', 'model_coordination', 'model_request', 'model_first_delta',
  'model_to_first_delta', 'agent_pre_model', 'agent_first_delta', 'agent_auth', 'session_start',
  'model_auth_max', 'model_request_max',
]);
const reflexReasons = new Set([
  'executed', 'unavailable', 'cancelled', 'not_addressed', 'not_action', 'incomplete_command',
  'low_confidence', 'confirmation_required', 'no_target', 'unsafe_target', 'unauthorized',
  'audit_unavailable', 'invalid_arguments', 'execution_failed', 'refused', 'error',
  'already_executed', 'shared_context_required', 'billing', 'auth', 'rate_limited', 'timeout',
  'invalid_answer', 'network_error',
]);
const visualPathReasons = new Set([
  'image_attached', 'image_request_accepted', 'image_context_limit',
  'image_accepted', 'image_rejected', 'image_timeout', 'image_unavailable',
  'frame_unavailable', 'frame_missing', 'budget_exhausted', 'budget_unavailable', 'legacy_agent',
  'image_input_unverified', 'timeout', 'daily_limit', 'frame_rate_limited', 'capture_failed',
  'camera_off', 'permission_denied', 'not_supported', 'session_ended', 'vision_failed',
]);
const boardReadStages = new Set(['project', 'token', 'source', 'task', 'release', 'response']);
const boardReadReasons = new Set([
  'request_failed', 'timeout', 'cancelled', 'transport_failed', 'invalid_response',
  'response_too_large', 'result_limit', 'incomplete_response', 'invalid_token_lifetime',
  'invalid_token_permissions', 'unexpected',
]);
const boardReadOutcomes = new Set(['success', 'failure', 'not_found', 'unavailable']);
const boardCachePaths = new Set(['not_started', 'cache_hit', 'shared_wait', 'source_load']);
const boardInvalidationOrigins = new Set(['task_event', 'github_webhook']);
const approvalFamilies = new Set(['calendar', 'mail', 'factory', 'github']);
const approvalVerdicts = new Set(['approve', 'decline', 'neither']);
const approvalPaths = new Set(['fast', 'model', 'failed']);
/** Why a PI turn failed, in our own words: the only vocabulary `pi.stream_failed` and `pi.stream_retry` may carry as a reason. */
const piStreamReasons = new Set([
  'foundry_response_failed', 'stream_ended_without_completed', 'stream_broke', 'approval_or_function_call_item',
  'no_stream', 'no_conversation', 'cancel_no_response_id', 'cancel_request_failed', 'deadline_notice_failed',
  'brain_wake_failed', 'client_tool_round_limit',
  'http_rate_limited',
]);
const piClientToolOutcomes = new Set(['answered_default', 'answered_task_client_owned', 'approved']);
/** The brain's own words for what a pass decided and why a sweep or wake ended: the only vocabularies `pi.brain_tick` and `pi.brain` may carry. */
const piBrainTickOutcomes = new Set<string>(brainTickOutcomes);
const piBrainReasons = new Set<string>(brainLogReasons);
/** Where a proactive scheduler, engine run or manual check failed: the only vocabulary `proactive.failed` may carry as a stage. */
const proactiveFailureStages = new Set([
  'startup', 'slot', 'run', 'run_finish', 'heartbeat', 'event_tick', 'manual_run', 'manual_run_finish',
]);
/** The kinds of turn the PI ledger records: the only vocabulary `pi.turn_record_failed` and `pi.usage_record_failed` may carry. */
const piTurnKinds = new Set<string>(allTurnKinds);
/** What a proactive push alert was about; `proactive.alert` lists them, comma-separated. */
const proactiveAlertClasses = new Set(['deadline_24h', 'calendar_clash', 'travel_disruption', 'insight']);
/** Who owned a harness call, and which rule decided: `native` calls ran inside the harness and were never answered. */
const piHarnessCallClasses = new Set(['native', 'client_owned', 'unknown']);
const piHarnessCallRules = new Set([
  'result_item', 'own_output', 'later_output', 'final_output', 'last_item_unanswered', 'incomplete_item', 'replayed',
]);
/** Fixed vocabularies of `weather.phase`: the step, how it ended and which provider host it called. */
const weatherPhases = new Set(['geocode', 'forecast', 'home_location', 'report']);
const weatherOutcomes = new Set(['ok', 'timeout', 'network', 'http_status', 'invalid', 'too_large']);
const weatherHosts = new Set(['open-meteo-geocoding', 'open-meteo-forecast']);
const piStreamEvents = new Set(['response.failed', 'response.incomplete', 'error']);
/** Fixed vocabularies of `pi.mcp_tool`: how a door call ended, the channel of its turn, which provider's tool it ran and whether replays could be recognised. */
const piMcpOutcomes = new Set(['ok', 'refused', 'error']);
const piMcpChannels = new Set(['chat', 'voice', 'wake', 'smoke']);
const piMcpProviders = new Set(['local', 'gh_', 'az_']);
const piMcpReplayChecks = new Set(['on', 'no_id', 'id_reused']);
const uuidShape = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const piAzureCatalogueStates = new Set([
  'idle', 'ready', 'stale', 'starting', 'unreachable', 'empty', 'not_configured', 'not_searched',
]);

function safeRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f-]{36}$/iu.test(value);
}

function safeBoardRoute(value: unknown): value is string {
  return typeof value === 'string' && /^\/[\w/:-]{0,100}$/u.test(value);
}

function safeBoardDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 60_000;
}

function safeFields(input: Record<string, unknown>): Record<string, unknown> {
  if (input.msg === 'reply_notification.delivery_outcome') {
    const fields: Record<string, unknown> = {};
    if (['accepted', 'retry', 'failed', 'expired', 'invalid_token'].includes(String(input.outcome))) {
      fields.outcome = input.outcome;
    }
    if (Number.isSafeInteger(input.attempt) && Number(input.attempt) >= 1 && Number(input.attempt) <= 5) {
      fields.attempt = input.attempt;
    }
    if (Number.isInteger(input.statusCode) && Number(input.statusCode) >= 100 &&
        Number(input.statusCode) <= 599) fields.statusCode = input.statusCode;
    return fields;
  }
  if (input.msg === 'watch_transcription.stage') {
    const fields: Record<string, unknown> = {};
    if (safeRequestId(input.reqId)) fields.reqId = input.reqId;
    const stages = [
      'request_accepted', 'credential_verified', 'owner_authenticated', 'audio_received', 'token_requested',
      'token_acquired', 'recognizer_started', 'audio_written', 'session_started', 'speech_start_detected',
      'speech_end_detected', 'first_recognizing', 'first_recognized', 'recognizer_stopped',
      'recognizer_cancelled', 'cleanup_started', 'cleanup_finished', 'deadline_exceeded', 'completed',
      'recognizer_starting', 'recognizer_start_failed', 'recognizer_start_timeout', 'service_connected', 'service_disconnected',
    ];
    if (typeof input.stage === 'string' && stages.includes(input.stage)) fields.stage = input.stage;
    if (typeof input.lastStage === 'string' && stages.includes(input.lastStage)) fields.lastStage = input.lastStage;
    for (const key of ['audioBytes', 'audioMs', 'errorCode'] as const) {
      const value = input[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) fields[key] = value;
    }
    if (typeof input.durationMs === 'number' && Number.isSafeInteger(input.durationMs) && input.durationMs >= 0) {
      fields.durationMs = input.durationMs;
    }
    if (typeof input.status === 'string' && ['success', 'failure', 'timeout'].includes(input.status)) {
      fields.status = input.status;
    }
    if (typeof input.reason === 'string' && [
      'end_of_stream', 'provider_cancelled', 'stop_awaiting_cancellation', 'early_stop', 'stop_grace_elapsed',
      'stop_without_result', 'client_disconnected', 'deadline_exceeded', 'completed', 'request_failed',
    ].includes(input.reason)) fields.reason = input.reason;
    return fields;
  }
  if (input.msg === 'voice.session_stage' || input.msg === 'voice.stage_timeout' ||
      input.msg === 'voice.session_summary' || input.msg === 'voice.tool_budget_attempt' ||
      input.msg === 'voice.tool_budget_selected' || input.msg === 'voice.tool_budget_exhausted' ||
      input.msg === 'voice.tool_budget_probe') {
    const fields: Record<string, unknown> = {};
    const nonnegative = (value: unknown): value is number =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (safeRequestId(input.reqId)) fields.reqId = input.reqId;
    if (input.language === 'en' || input.language === 'da') fields.language = input.language;
    for (const key of [
      'elapsedMs', 'durationMs', 'timeoutMs', 'toolCount', 'totalBytes', 'toolBytes', 'instructionsBytes',
      'frameBytes', 'attempts', 'toolBudgetAttempts',
    ]) {
      if (nonnegative(input[key])) fields[key] = input[key];
    }
    for (const key of ['rung', 'toolBudgetRung']) {
      if (typeof input[key] === 'string' && /^R[0-5]$/u.test(input[key])) fields[key] = input[key];
      else if (key === 'toolBudgetRung' && input[key] === null) fields[key] = null;
    }
    if (['ready', 'timeout', 'error', 'closed'].includes(String(input.outcome))) fields.outcome = input.outcome;
    if (input.msg === 'voice.tool_budget_probe' &&
        ['full', 'no_proactive', 'no_daily', 'reduced_plus_copies'].includes(String(input.probe))) {
      fields.probe = input.probe;
    }
    if (typeof input.remembered === 'boolean') fields.remembered = input.remembered;
    if (typeof input.stage === 'string' &&
        (voiceStages.has(input.stage) || [...voiceTimeoutStages].some((stage) => stage === input.stage))) {
      fields.stage = input.stage;
    }
    if (typeof input.lastStage === 'string' && voiceStages.has(input.lastStage)) fields.lastStage = input.lastStage;
    if (['browser', 'upstream', 'relay', 'shutdown'].includes(String(input.closedBy))) fields.closedBy = input.closedBy;
    if (input.endReason === 'inactivity' || input.endReason === 'max_duration') fields.endReason = input.endReason;
    if (nonnegative(input.closeCode) && input.closeCode >= 1000 && input.closeCode <= 4999) {
      fields.closeCode = input.closeCode;
    }
    if (Array.isArray(input.stages)) fields.stages = input.stages.slice(0, voiceStages.size).flatMap((entry: unknown) => {
      if (entry === null || typeof entry !== 'object') return [];
      const { stage, elapsedMs } = entry as Record<string, unknown>;
      return typeof stage === 'string' && voiceStages.has(stage) && nonnegative(elapsedMs)
        ? [{ stage, elapsedMs }] : [];
    });
    if (Array.isArray(input.events)) {
      fields.events = [...new Set(input.events.filter((event: unknown) =>
        typeof event === 'string' && voiceEventTypes.has(event)))].slice(0, voiceEventTypes.size);
    }
    if (Array.isArray(input.largestTools)) fields.largestTools = input.largestTools.slice(0, 5).flatMap((tool: unknown) => {
      if (tool === null || typeof tool !== 'object') return [];
      const { name, bytes } = tool as Record<string, unknown>;
      return typeof name === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(name) && nonnegative(bytes)
        ? [{ name, bytes }] : [];
    });
    return fields;
  }
  if (input.msg === 'system.smoke_check') {
    const checkId = systemSmokeCheckIds.find((id) => id === input.checkId);
    if (!checkId) return {};
    const fields: Record<string, unknown> = { checkId };
    if (input.status === 'ok' || input.status === 'degraded' ||
        input.status === 'down' || input.status === 'unknown') fields.status = input.status;
    if (input.status === 'down' || input.status === 'degraded') {
      const reason = safeSmokeReason(checkId, input.reason);
      if (reason) fields.reason = reason;
    }
    return fields;
  }
  if (input.msg === 'factory.board_read_failed' || input.msg === 'factory.board_project_lookup_failed') {
    const fields: Record<string, unknown> = {};
    if (safeRequestId(input.reqId)) fields.reqId = input.reqId;
    if (safeBoardRoute(input.route)) fields.route = input.route;
    if (typeof input.stage === 'string' && boardReadStages.has(input.stage)) fields.stage = input.stage;
    if (typeof input.reason === 'string' && boardReadReasons.has(input.reason)) fields.reason = input.reason;
    if (typeof input.status === 'number' && Number.isInteger(input.status) &&
        input.status >= 100 && input.status <= 599) fields.status = input.status;
    if (typeof input.stale === 'boolean') fields.stale = input.stale;
    return fields;
  }
  if (input.msg === 'factory.board_phase') {
    const fields: Record<string, unknown> = {};
    if (safeRequestId(input.reqId)) fields.reqId = input.reqId;
    if (safeBoardRoute(input.route)) fields.route = input.route;
    if (typeof input.stage === 'string' && boardReadStages.has(input.stage)) fields.stage = input.stage;
    if (input.part === 'assemble' || input.part === 'serialize') fields.part = input.part;
    if (input.durationUnavailable === true) fields.durationUnavailable = true;
    else if (input.durationCensored === true) fields.durationCensored = true;
    else if (safeBoardDuration(input.durationMs)) fields.durationMs = input.durationMs;
    return fields;
  }
  if (input.msg === 'factory.board_read_timing') {
    const fields: Record<string, unknown> = {};
    if (safeRequestId(input.reqId)) fields.reqId = input.reqId;
    if (safeBoardRoute(input.route)) fields.route = input.route;
    if (typeof input.outcome === 'string' && boardReadOutcomes.has(input.outcome)) fields.outcome = input.outcome;
    if (typeof input.cachePath === 'string' && boardCachePaths.has(input.cachePath)) fields.cachePath = input.cachePath;
    if (typeof input.stale === 'boolean') fields.stale = input.stale;
    if (input.cacheElapsedUnavailable === true) fields.cacheElapsedUnavailable = true;
    else if (input.cacheElapsedCensored === true) fields.cacheElapsedCensored = true;
    else if (safeBoardDuration(input.cacheElapsedMs)) fields.cacheElapsedMs = input.cacheElapsedMs;
    if (Number.isInteger(input.statusCode) && Number(input.statusCode) >= 100 &&
        Number(input.statusCode) <= 599) fields.statusCode = input.statusCode;
    return fields;
  }
  if (input.msg === 'factory.board_invalidated') {
    const fields: Record<string, unknown> = {};
    if (typeof input.origin === 'string' && boardInvalidationOrigins.has(input.origin)) fields.origin = input.origin;
    if (typeof input.projectId === 'string' && /^[1-9]\d{0,18}$/u.test(input.projectId)) {
      fields.projectId = input.projectId;
    }
    if (Number.isSafeInteger(input.version) && Number(input.version) >= 1 &&
        Number(input.version) <= 1_000_000_000) fields.version = input.version;
    if (input.scope === 'all_projects') fields.scope = input.scope;
    if (safeRequestId(input.reqId)) fields.reqId = input.reqId;
    return fields;
  }
  if (input.msg === 'visual.path') {
    const fields: Record<string, unknown> = {};
    if (input.path === 'image' || input.path === 'caption') fields.path = input.path;
    if (typeof input.reason === 'string' && visualPathReasons.has(input.reason)) fields.reason = input.reason;
    if (input.channel === 'chat' || input.channel === 'voice') {
      fields.channel = input.channel;
    }
    if (typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs) &&
        input.latencyMs >= 0 && input.latencyMs <= 600_000) fields.latencyMs = input.latencyMs;
    if (typeof input.captionMs === 'number' && Number.isFinite(input.captionMs) &&
        input.captionMs >= 0 && input.captionMs <= 600_000) fields.captionMs = input.captionMs;
    return fields;
  }
  if (input.msg === 'chat.agent_session') {
    const fields: Record<string, unknown> = {};
    if (typeof input.sessionIdUsed === 'boolean') fields.sessionIdUsed = input.sessionIdUsed;
    if (['cold', 'warm', 'resume'].includes(String(input.sessionStartType))) {
      fields.sessionStartType = input.sessionStartType;
    }
    for (const key of ['platformMs', 'provisioningMs', 'containerMs', 'agentMs']) {
      const value = input[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 600_000) {
        fields[key] = value;
      }
    }
    if (typeof input.fallbackReason === 'string' && /^http_4\d{2}$/u.test(input.fallbackReason)) {
      fields.fallbackReason = input.fallbackReason;
    }
    return fields;
  }
  if (input.msg === 'decision.provider_unavailable') {
    return ['jev', 'microsoft'].includes(String(input.provider)) ? { provider: input.provider } : {};
  }
  if (input.msg === 'approval.interpreted') {
    const fields: Record<string, unknown> = {};
    if (typeof input.family === 'string' && approvalFamilies.has(input.family)) fields.family = input.family;
    if (typeof input.verdict === 'string' && approvalVerdicts.has(input.verdict)) fields.verdict = input.verdict;
    if (typeof input.path === 'string' && approvalPaths.has(input.path)) fields.path = input.path;
    return fields;
  }
  if (input.msg === 'tool.invalid_arguments') {
    const fields: Record<string, unknown> = {};
    if (typeof input.tool === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(input.tool)) fields.tool = input.tool;
    if (['additionalProperties', 'required', 'type', 'enum', 'const', 'minLength', 'maxLength',
      'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'format',
      'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
      'anyOf', 'oneOf', 'allOf', 'not', 'if', 'schema', 'json'].includes(String(input.keyword))) {
      fields.keyword = input.keyword;
    }
    if (typeof input.property === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u.test(input.property)) {
      fields.property = input.property;
    }
    if (typeof input.instancePath === 'string' && input.instancePath.length <= 512 &&
        /^(?:\/(?:[A-Za-z_][A-Za-z0-9_-]{0,63}|\d{1,10}))*$/u.test(input.instancePath)) {
      fields.instancePath = input.instancePath;
    }
    return fields;
  }
  if (input.msg === 'tool.execution_failed') {
    const fields: Record<string, unknown> = {};
    if (typeof input.tool === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(input.tool)) fields.tool = input.tool;
    if (['stopped', 'timeout', 'dropped', 'not_sent', 'unexpected'].includes(String(input.failureClass))) {
      fields.failureClass = input.failureClass;
    }
    if (['read', 'action', 'unclassified'].includes(String(input.effect))) fields.effect = input.effect;
    // The error's own class as short tokens (a name and a code); never its message.
    for (const key of ['errorName', 'causeName']) {
      const value = input[key];
      if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(value)) fields[key] = value;
    }
    for (const key of ['errorCode', 'causeCode']) {
      const value = input[key];
      if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value)) fields[key] = value;
    }
    return fields;
  }
  if (input.msg === 'proactive.model_failed' || input.msg === 'image_generation.failed') {
    const fields: Record<string, unknown> = {};
    const reasons = input.msg === 'proactive.model_failed'
      ? ['response_size_or_json', 'response_envelope', 'completion_incomplete', 'invalid_json', 'invalid_findings', 'model_unavailable']
      : ['credential_unavailable', 'credential_missing', 'transport_failed', 'provider_http_error', 'empty_response', 'invalid_image_response', 'artifact_storage_failed'];
    if (typeof input.reason === 'string' && reasons.includes(input.reason)) fields.reason = input.reason;
    if (input.msg === 'proactive.model_failed' && typeof input.outputTokens === 'number' &&
        Number.isSafeInteger(input.outputTokens) && input.outputTokens >= 0 && input.outputTokens <= 1_000_000) {
      fields.outputTokens = input.outputTokens;
    }
    if (input.msg === 'image_generation.failed' && typeof input.status === 'number' &&
        Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) fields.status = input.status;
    return fields;
  }
  if (input.msg === 'proactive.failed') {
    const fields: Record<string, unknown> = {};
    if (typeof input.runId === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(input.runId)) {
      fields.runId = input.runId;
    }
    if (typeof input.reason === 'string' &&
        ['internal_error', 'hook_failed', 'job_update_failed'].includes(input.reason)) fields.reason = input.reason;
    // Where it failed, and the class of what was thrown (a code identifier such as `RequestError`), never its message.
    if (typeof input.stage === 'string' && proactiveFailureStages.has(input.stage)) fields.stage = input.stage;
    if (typeof input.errorClass === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(input.errorClass)) {
      fields.errorClass = input.errorClass;
    }
    return fields;
  }
  if (input.msg === 'proactive.todo_writer') {
    const fields: Record<string, unknown> = {};
    if (typeof input.runId === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(input.runId)) {
      fields.runId = input.runId;
    }
    const reasons = new Set([
      'run_aborted', 'paused', 'todos_disabled', 'quiet_hours', 'todo_daily_cap', 'todo_run_cap',
      'settings_unavailable', 'receipt_read_failed', 'receipt_write_failed', 'invalid_text',
      'unsafe_text', 'duplicate', 'todo_file_missing', 'todo_file_ambiguous',
      'todo_file_unwritable', 'todo_file_too_large', 'vault_app_not_installed',
      'vault_write_failed', 'vault_conflict_exhausted', 'vault_unavailable',
      'todo_added', 'todo_recovered', 'todo_item_update_failed',
    ]);
    if (typeof input.reason === 'string' && reasons.has(input.reason)) fields.reason = input.reason;
    if (Array.isArray(input.itemIds)) {
      const itemIds = input.itemIds.filter((id): id is string => typeof id === 'string' &&
        /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(id)).slice(0, 20);
      if (itemIds.length > 0) fields.itemIds = itemIds;
    }
    if (typeof input.count === 'number' && Number.isInteger(input.count) && input.count >= 0 && input.count <= 100) {
      fields.count = input.count;
    }
    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) &&
        input.durationMs >= 0 && input.durationMs <= 180_000) fields.durationMs = input.durationMs;
    return fields;
  }
  if (input.msg === 'daily.gym_log') {
    const fields: Record<string, unknown> = {};
    if (typeof input.reason === 'string' && ['vault_write_failed', 'aborted'].includes(input.reason)) fields.reason = input.reason;
    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) &&
        input.durationMs >= 0 && input.durationMs <= 180_000) fields.durationMs = input.durationMs;
    return fields;
  }
  if (input.msg === 'proactive.reminder_plan') {
    const fields: Record<string, unknown> = {};
    if (input.runId === null ||
        (typeof input.runId === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(input.runId))) {
      fields.runId = input.runId;
    }
    const reasons = new Set([
      'aborted', 'paused', 'todos_unavailable', 'planned', 'plan_cap', 'planner_failed',
      'vault_push_planner_unconfigured', 'vault_push_trigger_failed', 'vault_push_quiet_hours',
      'vault_push_paused', 'vault_push_todos_disabled', 'vault_push_todos_unavailable',
      'vault_push_plan_cap', 'vault_push_planned', 'vault_push_no_new_rows',
      'vault_push_timeout', 'vault_push_aborted', 'vault_push_failed',
    ]);
    if (typeof input.reason === 'string' && reasons.has(input.reason)) fields.reason = input.reason;
    if (typeof input.count === 'number' && Number.isInteger(input.count) && input.count >= 0 && input.count <= 100) {
      fields.count = input.count;
    }
    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) &&
        input.durationMs >= 0 && input.durationMs <= 180_000) fields.durationMs = input.durationMs;
    return fields;
  }
  if (input.msg === 'proactive.reminder_tick' || input.msg === 'proactive.alert' || input.msg === 'proactive.events' ||
      input.msg === 'proactive.events_disabled' || input.msg === 'proactive.event_model_failed' ||
      input.msg === 'proactive.event_producer' || input.msg === 'proactive.event_source') {
    // Our own reason words, a source's name, counts and timings: never a reminder, an alert, an event, its summary, a source's text or a push endpoint.
    const fields: Record<string, unknown> = {};
    const token = /^[a-z][a-z0-9_.-]{0,63}$/u;
    if (typeof input.runId === 'string' && uuidShape.test(input.runId)) fields.runId = input.runId;
    if (typeof input.reason === 'string' && token.test(input.reason)) fields.reason = input.reason;
    if (typeof input.source === 'string' && token.test(input.source)) fields.source = input.source;
    if (typeof input.classes === 'string' && input.classes.length <= 120 &&
        input.classes.split(',').every((value) => proactiveAlertClasses.has(value))) fields.classes = input.classes;
    for (const key of ['count', 'events', 'outreach', 'dropped', 'outputTokens']) {
      const value = input[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000) fields[key] = value;
    }
    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) &&
        input.durationMs >= 0 && input.durationMs <= 3_600_000) fields.durationMs = input.durationMs;
    return fields;
  }
  if (typeof input.msg === 'string' && ownerSessionEvents.has(input.msg)) {
    if (input.msg === 'owner_session.boot_revoke') {
      const fields: Record<string, unknown> = {};
      if (['revoked', 'table_missing', 'skipped', 'failed'].includes(String(input.outcome))) {
        fields.outcome = input.outcome;
      }
      if (typeof input.count === 'number' && Number.isSafeInteger(input.count) && input.count >= 0) {
        fields.count = input.count;
      }
      return fields;
    }
    // Audit events carry a reason category and an 8-character session id prefix, never a token, secret or hash.
    const fields: Record<string, unknown> = {};
    const smallCount = (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
    if (safeRequestId(input.reqId)) fields.reqId = input.reqId;
    if (typeof input.method === 'string' && /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/u.test(input.method)) {
      fields.method = input.method;
    }
    if (typeof input.route === 'string' && /^\/[\w/:-]{0,100}$/u.test(input.route)) fields.route = input.route;
    if (typeof input.reason === 'string' && ownerSessionReasons.has(input.reason)) fields.reason = input.reason;
    if (typeof input.sessionPrefix === 'string' && /^[\w-]{8}$/u.test(input.sessionPrefix)) {
      fields.sessionPrefix = input.sessionPrefix;
    }
    if (input.scope === 'current' || input.scope === 'all') fields.scope = input.scope;
    if (smallCount(input.count)) fields.count = input.count;
    if (smallCount(input.evicted)) fields.evicted = input.evicted;
    if (typeof input.statusCode === 'number' && Number.isInteger(input.statusCode) &&
        input.statusCode >= 100 && input.statusCode <= 599) fields.statusCode = input.statusCode;
    return fields;
  }
  if (input.msg === 'weather.phase') {
    // Step name, outcome, status, attempt, duration and provider host only: never a place, coordinate, query or provider text.
    const fields: Record<string, unknown> = {};
    if (typeof input.phase === 'string' && weatherPhases.has(input.phase)) fields.phase = input.phase;
    if (typeof input.outcome === 'string' && weatherOutcomes.has(input.outcome)) fields.outcome = input.outcome;
    if (Number.isInteger(input.status) && Number(input.status) >= 100 && Number(input.status) <= 599) fields.status = input.status;
    if (Number.isInteger(input.attempt) && Number(input.attempt) >= 1 && Number(input.attempt) <= 2) fields.attempt = input.attempt;
    if (typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0 && input.elapsedMs <= 600_000) {
      fields.elapsedMs = input.elapsedMs;
    }
    if (typeof input.host === 'string' && weatherHosts.has(input.host)) fields.host = input.host;
    return fields;
  }
  if (input.msg === 'pi.brain_tick' || input.msg === 'pi.brain_state' || input.msg === 'pi.brain' || input.msg === 'pi.brain_run') {
    // The brain's fixed words and numbers: never an event, its summary, a message to Dan, a tool argument, a provider message or the id of what it touched.
    const fields: Record<string, unknown> = {};
    const count = (value: unknown, max: number): value is number =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
    const amount = (value: unknown, max: number): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
    if (input.msg === 'pi.brain_tick') {
      if (typeof input.outcome === 'string' && piBrainTickOutcomes.has(input.outcome)) fields.outcome = input.outcome;
      if (count(input.queued, 1_000_000)) fields.queued = input.queued;
      if (count(input.wakesToday, 10_000)) fields.wakesToday = input.wakesToday;
      if (count(input.nextDueInSec, 7 * 86_400)) fields.nextDueInSec = input.nextDueInSec;
      if (amount(input.spendMonthDkk, 1_000_000)) fields.spendMonthDkk = input.spendMonthDkk;
    } else if (input.msg === 'pi.brain_state') {
      for (const key of ['enabled', 'paused']) if (typeof input[key] === 'boolean') fields[key] = input[key];
      if (input.reason === 'unreadable') fields.reason = input.reason;
    } else if (input.msg === 'pi.brain') {
      if (typeof input.reason === 'string' && piBrainReasons.has(input.reason)) fields.reason = input.reason;
      if (input.trigger === 'scheduled' || input.trigger === 'catchup' || input.trigger === 'manual') fields.trigger = input.trigger;
      for (const key of ['events', 'sent', 'tools', 'pending']) if (count(input[key], 1_000_000)) fields[key] = input[key];
      if (amount(input.costDkk, 1_000)) fields.costDkk = input.costDkk;
    } else {
      if (['ok', 'failed', 'cancelled', 'timeout'].includes(String(input.outcome))) fields.outcome = input.outcome;
      for (const key of ['firstTextMs', 'totalMs']) if (amount(input[key], 3_600_000)) fields[key] = input[key];
      for (const key of ['inputTokens', 'cachedTokens', 'outputTokens']) if (count(input[key], 100_000_000)) fields[key] = input[key];
      for (const key of ['tools', 'staleSourceCount', 'actionCount', 'pushCount']) if (count(input[key], 10_000)) fields[key] = input[key];
      if (count(input.stateRevision, Number.MAX_SAFE_INTEGER)) fields.stateRevision = input.stateRevision;
      if (typeof input.estimated === 'boolean') fields.estimated = input.estimated;
      if (amount(input.costDkk, 1_000)) fields.costDkk = input.costDkk;
      if (typeof input.activationId === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(input.activationId)) {
        fields.activationId = input.activationId;
      }
      if (['chat', 'voice', 'scheduled', 'event'].includes(String(input.activationType))) fields.activationType = input.activationType;
      if (typeof input.activationSource === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/u.test(input.activationSource)) {
        fields.activationSource = input.activationSource;
      }
    }
    return fields;
  }
  if (input.msg === 'pi.turn_record_failed' || input.msg === 'pi.usage_record_failed' ||
      input.msg === 'pi.situation_stale_failed' || input.msg === 'pi.watches') {
    // A write or refresh that failed and what it was for: the kind of turn, the wake's id or a fixed reason. Never the turn, its text or its cost.
    const fields: Record<string, unknown> = {};
    if (typeof input.kind === 'string' && piTurnKinds.has(input.kind) &&
        (input.msg === 'pi.turn_record_failed' || input.msg === 'pi.usage_record_failed')) fields.kind = input.kind;
    if (input.msg === 'pi.situation_stale_failed' && typeof input.activationId === 'string' && uuidShape.test(input.activationId)) {
      fields.activationId = input.activationId;
    }
    if (input.msg === 'pi.watches' && input.reason === 'watch_index_refresh_failed') fields.reason = input.reason;
    return fields;
  }
  if (input.msg === 'pi.conversation_cleanup_failed') {
    return {
      ...(input.kind === 'brain' || input.kind === 'smoke' ? { kind: input.kind } : {}),
      ...(input.reason === 'timeout' || input.reason === 'request_failed' ? { reason: input.reason } : {}),
    };
  }
  if (input.msg === 'pi.harness_item') {
    // The shape of an item the harness sent: lowercase tokens, booleans and numbers only, and for a function call or approval request its owner (native or client-owned), the deciding rule and the argument key names. Never argument values, output, ids, URLs or free text.
    const fields: Record<string, unknown> = {};
    const token = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/u.test(value);
    if (input.trigger === 'rejected_item' || input.trigger === 'unknown_item' || input.trigger === 'harness_call') fields.trigger = input.trigger;
    if (typeof input.classification === 'string' && piHarnessCallClasses.has(input.classification)) fields.classification = input.classification;
    if (typeof input.rule === 'string' && piHarnessCallRules.has(input.rule)) fields.rule = input.rule;
    if (typeof input.outcome === 'string' && piClientToolOutcomes.has(input.outcome)) fields.outcome = input.outcome;
    if (Number.isInteger(input.round) && Number(input.round) >= 1 && Number(input.round) <= 8) fields.round = input.round;
    if (Array.isArray(input.argumentKeys)) {
      fields.argumentKeys = input.argumentKeys
        .filter((key): key is string => typeof key === 'string' && /^[a-z0-9_.-]{1,32}$/u.test(key)).slice(0, 12);
    }
    for (const key of ['itemType', 'name', 'serverLabel', 'itemStatus']) if (token(input[key])) fields[key] = input[key];
    for (const key of ['hasCallId', 'hasId', 'sawText', 'sawTool', 'sawOutput', 'previousCancelled']) {
      if (typeof input[key] === 'boolean') fields[key] = input[key];
    }
    if (Number.isInteger(input.attempt) && Number(input.attempt) >= 1 && Number(input.attempt) <= 3) fields.attempt = input.attempt;
    if (Number.isInteger(input.argumentsLength) && Number(input.argumentsLength) >= 0 && Number(input.argumentsLength) <= 100_000_000) {
      fields.argumentsLength = input.argumentsLength;
    }
    for (const key of ['elapsedMs', 'firstEventMs']) {
      const value = input[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 600_000) fields[key] = value;
    }
    for (const key of ['eventTypes', 'itemTypes']) {
      if (Array.isArray(input[key])) fields[key] = input[key].filter(token).slice(0, 25);
    }
    return fields;
  }
  if (input.msg === 'pi.mcp_tool') {
    // One finished MCP door call: the tool's name, how it ended, how long it took, how big the answer was, the channel and
    // provider, an 8-hex hash of the turn reference, whether the request was a replay or an identical action repeated, whether
    // replays could be recognised, and the names (never the values) of the request's `_meta` keys.
    // Never arguments, result text, `_meta` values or the reference itself.
    const fields: Record<string, unknown> = {};
    if (typeof input.tool === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(input.tool)) fields.tool = input.tool;
    if (typeof input.outcome === 'string' && piMcpOutcomes.has(input.outcome)) fields.outcome = input.outcome;
    if (typeof input.channel === 'string' && piMcpChannels.has(input.channel)) fields.channel = input.channel;
    if (typeof input.provider === 'string' && piMcpProviders.has(input.provider)) fields.provider = input.provider;
    if (typeof input.replayCheck === 'string' && piMcpReplayChecks.has(input.replayCheck)) fields.replayCheck = input.replayCheck;
    if (Array.isArray(input.metaKeys)) {
      const metaKeys = input.metaKeys
        .filter((key): key is string => typeof key === 'string' && /^[A-Za-z0-9_.:/-]{1,64}$/u.test(key)).slice(0, 12);
      if (metaKeys.length > 0) fields.metaKeys = metaKeys;
    }
    if (typeof input.turnHash === 'string' && /^[0-9a-f]{8}$/u.test(input.turnHash)) fields.turnHash = input.turnHash;
    if (typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0 && input.elapsedMs <= 600_000) {
      fields.elapsedMs = input.elapsedMs;
    }
    if (Number.isSafeInteger(input.resultBytes) && Number(input.resultBytes) >= 0 && Number(input.resultBytes) <= 100_000_000) {
      fields.resultBytes = input.resultBytes;
    }
    for (const key of ['truncated', 'duplicate', 'sameArgsRepeat']) if (typeof input[key] === 'boolean') fields[key] = input[key];
    return fields;
  }
  if (input.msg === 'pi.stream_failed' || input.msg === 'pi.stream_retry' ||
      input.msg === 'pi.mcp_list_failed' || input.msg === 'pi.mcp_call_failed' || input.msg === 'pi.smoke_failed') {
    // Fixed summaries, short labels and numbers only: never raw provider text.
    const fields: Record<string, unknown> = {};
    if (typeof input.reason === 'string' && piStreamReasons.has(input.reason)) fields.reason = input.reason;
    if (typeof input.event === 'string' && piStreamEvents.has(input.event)) fields.event = input.event;
    if (typeof input.code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/u.test(input.code)) fields.code = input.code;
    for (const key of ['server', 'tool']) {
      const value = input[key];
      if (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/u.test(value)) fields[key] = value;
    }
    if (Number.isInteger(input.status) && Number(input.status) >= 100 && Number(input.status) <= 599) fields.status = input.status;
    if (Number.isInteger(input.attempt) && Number(input.attempt) >= 1 && Number(input.attempt) <= 3) fields.attempt = input.attempt;
    if (input.msg === 'pi.stream_failed' || input.msg === 'pi.stream_retry') {
      if (Number.isInteger(input.round) && Number(input.round) >= 1 && Number(input.round) <= 8) fields.round = input.round;
      if (typeof input.providerMessage === 'string' && safeRateLimitMessages.has(input.providerMessage)) {
        fields.providerMessage = input.providerMessage;
      }
      for (const key of ['retryAfterMs', 'delayMs']) {
        if (Number.isSafeInteger(input[key]) && Number(input[key]) >= 0) fields[key] = input[key];
      }
    }
    for (const key of ['elapsedMs', 'firstEventMs']) {
      const value = input[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 600_000) fields[key] = value;
    }
    for (const key of ['sawText', 'sawTool', 'sawOutput', 'previousCancelled']) {
      if (typeof input[key] === 'boolean') fields[key] = input[key];
    }
    return fields;
  }
  if (input.msg === 'tool.audit_failed') {
    // A tool ran and its audit row was lost: which tool and how it ended, and the kind of error, never the error's text.
    const fields: Record<string, unknown> = {};
    if (typeof input.tool === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(input.tool)) fields.tool = input.tool;
    if (['ok', 'refused', 'error'].includes(String(input.outcome))) fields.outcome = input.outcome;
    if (typeof input.kind === 'string' && errorKinds.has(input.kind)) fields.kind = input.kind;
    return fields;
  }
  if (typeof input.msg === 'string' && failureEvents.has(input.msg)) {
    const fields: Record<string, unknown> = {};
    if (typeof input.kind === 'string' && errorKinds.has(input.kind)) fields.kind = input.kind;
    if (typeof input.statusCode === 'number' && Number.isInteger(input.statusCode) &&
        input.statusCode >= 100 && input.statusCode <= 599) fields.statusCode = input.statusCode;
    if (input.msg === 'request.failed' && typeof input.route === 'string' &&
        /^\/[\w/:-]{0,100}$/u.test(input.route)) fields.route = input.route;
    return fields;
  }
  const fields: Record<string, unknown> = {};
  if (typeof input.reqId === 'string' && /^[\da-f-]{36}$/i.test(input.reqId)) fields.reqId = input.reqId;
  if (typeof input.method === 'string' && /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(input.method)) fields.method = input.method;
  if (typeof input.route === 'string' && /^\/[\w/:-]{0,100}$/.test(input.route)) fields.route = input.route;
  if (typeof input.reason === 'string' && authDenialReasons.has(input.reason)) fields.reason = input.reason;
  if (input.msg === 'reflex.decision') {
    if (['chat', 'voice-partial', 'voice-final'].includes(String(input.source))) fields.source = input.source;
    if (['action', 'question', 'other'].includes(String(input.intent))) fields.intent = input.intent;
    if (['jev', 'microsoft'].includes(String(input.provider))) fields.provider = input.provider;
    if (['<0.5', '0.5–0.8', '>0.8'].includes(String(input.confidence))) fields.confidence = input.confidence;
    for (const key of ['addressed', 'completeCommand', 'executed']) {
      if (typeof input[key] === 'boolean') fields[key] = input[key];
    }
    if (typeof input.tool === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(input.tool)) fields.tool = input.tool;
    if (typeof input.reason === 'string' &&
        (reflexReasons.has(input.reason) || /^http_[1-5]\d{2}$/u.test(input.reason))) {
      fields.reason = input.reason;
    }
    if (typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs) &&
        input.latencyMs >= 0 && input.latencyMs <= 600_000) fields.latencyMs = input.latencyMs;
  }
  for (const key of ['statusCode', 'responseTime', 'port']) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) fields[key] = input[key];
  }
  if (input.msg === 'credentials.codex_renewal') {
    if (['skipped', 'fresh', 'renewed', 'failed', 'uncertain'].includes(String(input.outcome))) {
      fields.outcome = input.outcome;
    }
    if (['http', 'auth', 'timeout', 'aborted', 'transport', 'protocol', 'internal'].includes(String(input.kind))) {
      fields.kind = input.kind;
    }
    if (!Number.isInteger(input.statusCode) || Number(input.statusCode) < 100 || Number(input.statusCode) > 599) {
      delete fields.statusCode;
    }
  }
  if (input.msg === 'dispatcher.start_failed') {
    if (typeof input.taskId === 'string' && /^[1-9]\d{0,18}$/.test(input.taskId)) fields.taskId = input.taskId;
    if (['credential_unavailable', 'session_persistence_failed', 'foundry_start_rejected',
      'foundry_start_failed', 'recovery_start_failed'].includes(String(input.reason))) {
      fields.reason = input.reason;
    }
  }
  if (input.msg === 'chat.latency') {
    if (typeof input.phase === 'string' && chatLatencyPhases.has(input.phase)) fields.phase = input.phase;
    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) &&
        input.durationMs >= 0 && input.durationMs <= 600_000) {
      fields.durationMs = input.durationMs;
    }
  }
  if (input.msg === 'memory.embedding') {
    if (typeof input.outcome === 'string' && ['ok', 'fallback', 'cancelled'].includes(input.outcome)) {
      fields.outcome = input.outcome;
    }
    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) &&
        input.durationMs >= 0 && input.durationMs <= 600_000) {
      fields.durationMs = input.durationMs;
    }
    if (Number.isSafeInteger(input.inputTokens) && Number(input.inputTokens) >= 0 &&
        Number(input.inputTokens) <= 1_000_000) {
      fields.inputTokens = input.inputTokens;
    }
    if (Number.isSafeInteger(input.httpStatus) && Number(input.httpStatus) >= 100 &&
        Number(input.httpStatus) <= 599) {
      fields.httpStatus = input.httpStatus;
    }
  }
  if (input.msg === 'vault.index') {
    if (['ok', 'error', 'refused'].includes(String(input.outcome))) fields.outcome = input.outcome;
    for (const key of ['added', 'changed', 'removed']) {
      const value = input[key];
      if (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000) fields[key] = value;
    }
    if (Array.isArray(input.folders)) {
      fields.folders = [...new Set(input.folders.map((folder) =>
        ['People', 'Work', 'Personal', 'General'].includes(String(folder))
          ? String(folder) : 'other'))].slice(0, 5);
    }
  }
  if (input.msg === 'vault.write') {
    if (['ok', 'error', 'refused'].includes(String(input.outcome))) fields.outcome = input.outcome;
    fields.folder = ['People', 'Work', 'Personal', 'General'].includes(String(input.folder))
      ? input.folder : 'other';
  }
  if (input.msg === 'inbox.write') {
    if (['create', 'replace', 'close'].includes(String(input.action))) fields.action = input.action;
    if (['ok', 'existing', 'conflict', 'error'].includes(String(input.outcome))) fields.outcome = input.outcome;
  }
  if (input.msg === 'inbox.nudge') {
    if (['nudged', 'quiet', 'nothing_to_review', 'model_unavailable', 'invalid_model_output', 'inbox_unavailable', 'trail_failed',
      'disabled', 'daily_ceiling', 'budget_exhausted', 'spend_not_recorded', 'audit_captured', 'audit_quiet'].includes(String(input.outcome))) fields.outcome = input.outcome;
  }
  if (input.msg === 'inbox.triage') {
    if (['model', 'raw'].includes(String(input.outcome))) fields.outcome = input.outcome;
  }
  if (input.msg === 'inbox.tool') {
    if (['inbox_capture', 'inbox_items', 'inbox_close'].includes(String(input.tool))) fields.tool = input.tool;
    if (input.outcome === 'error') fields.outcome = input.outcome;
  }
  if (input.msg === 'vision.watch') {
    if (input.source === 'screen' || input.source === 'camera') fields.source = input.source;
    for (const key of ['noteworthy', 'spoke']) {
      if (typeof input[key] === 'boolean') fields[key] = input[key];
    }
    for (const key of ['latencyMs', 'cost']) {
      if (typeof input[key] === 'number' && Number.isFinite(input[key]) && input[key] >= 0) fields[key] = input[key];
    }
  }
  if (input.msg === 'pc_act.step') {
    if (Number.isSafeInteger(input.step) && Number(input.step) >= 1 && Number(input.step) <= 20) {
      fields.step = input.step;
    }
    if (['click', 'type', 'scroll_up', 'scroll_down', 'wait', 'done', 'blocked']
      .includes(String(input.action))) fields.action = input.action;
    if (['completed', 'refused', 'error'].includes(String(input.outcome))) fields.outcome = input.outcome;
  }
  if (input.msg === 'pi.turn' || input.msg === 'voice.pi_turn') {
    if (input.channel === 'chat' || input.channel === 'voice') fields.channel = input.channel;
    if (['ok', 'failed', 'cancelled', 'timeout', 'superseded'].includes(String(input.outcome))) fields.outcome = input.outcome;
    if (typeof input.estimated === 'boolean') fields.estimated = input.estimated;
    for (const key of ['firstTextMs', 'totalMs', 'transcriptToFirstTextMs', 'transcriptToDoneMs', 'transcriptToSpeakMs',
      'inputTokens', 'cachedTokens', 'outputTokens']) {
      const value = input[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100_000_000) fields[key] = value;
    }
    if (typeof input.costDkk === 'number' && Number.isFinite(input.costDkk) && input.costDkk >= 0 && input.costDkk <= 1_000) {
      fields.costDkk = input.costDkk;
    }
    if (typeof input.acknowledged === 'boolean') fields.acknowledged = input.acknowledged;
    if (input.budgetRead === 'unavailable') fields.budgetRead = input.budgetRead;
    if (Number.isSafeInteger(input.toolCount) && Number(input.toolCount) >= 0 && Number(input.toolCount) <= 10_000) fields.toolCount = input.toolCount;
    if (input.msg === 'pi.turn') {
      if (Number.isInteger(input.rounds) && Number(input.rounds) >= 1 && Number(input.rounds) <= 8) fields.rounds = input.rounds;
      if (Number.isInteger(input.clientItems) && Number(input.clientItems) >= 0 && Number(input.clientItems) <= 1_000) fields.clientItems = input.clientItems;
      if (Number.isInteger(input.nativeCalls) && Number(input.nativeCalls) >= 0 && Number(input.nativeCalls) <= 10_000) fields.nativeCalls = input.nativeCalls;
    }
    if (typeof input.azureCatalogue === 'string' && piAzureCatalogueStates.has(input.azureCatalogue)) fields.azureCatalogue = input.azureCatalogue;
  }
  if (input.msg === 'voice.delegation_received' || input.msg === 'voice.owner_group_persisted' ||
      input.msg === 'voice.did_not_catch' || input.msg === 'voice.pi_turn_started') {
    // Lengths, timings and opaque ids only; the owner's words never reach these events.
    const identifier = (value: unknown): value is string =>
      typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
    for (const key of ['delegationId', 'groupId']) {
      if (identifier(input[key])) fields[key] = input[key];
    }
    for (const key of ['textLength', 'offsetMs', 'quietMs', 'waitedMs']) {
      const value = input[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000) {
        fields[key] = value;
      }
    }
    if (typeof input.reusedGroup === 'boolean') fields.reusedGroup = input.reusedGroup;
    if (input.language === 'da' || input.language === 'en') fields.language = input.language;
    if (input.msg === 'voice.delegation_received' &&
        ['attached', 'adopted_stored_turn', 'ignored_newer_owner_turn'].includes(String(input.outcome))) fields.outcome = input.outcome;
    if (input.msg === 'voice.owner_group_persisted' &&
        ['delegated', 'direct_quiet', 'before_output', 'session_end'].includes(String(input.reason))) {
      fields.reason = input.reason;
    }
  }
  if (input.msg === 'voice.activity_published') {
    // The state a client sees, what published it and what was still busy: no content.
    if (['listening', 'thinking', 'speaking', 'interrupted', 'reconnecting', 'failed', 'ended']
      .includes(String(input.state))) fields.state = input.state;
    if ([
      'response_started', 'response_completed', 'pi_started', 'pi_finished', 'delegation_received',
      'input_transcript', 'input_audio', 'output_audio', 'microphone_active', 'microphone_muted',
      'playback_completed', 'session_ended', 'session_failed', 'session_reconnecting',
    ].includes(String(input.reason))) fields.reason = input.reason;
    if (typeof input.sinceLastMs === 'number' && Number.isSafeInteger(input.sinceLastMs) &&
        input.sinceLastMs >= 0 && input.sinceLastMs <= 100_000_000) fields.sinceLastMs = input.sinceLastMs;
    for (const key of ['outputActive', 'piBusy', 'delegationPending']) {
      if (typeof input[key] === 'boolean') fields[key] = input[key];
    }
    if (input.language === 'da' || input.language === 'en') fields.language = input.language;
  }
  if (input.msg === 'voice.turn_timing') {
    if (typeof input.turnId === 'string' && /^[\da-f-]{36}$/iu.test(input.turnId)) {
      fields.turnId = input.turnId;
    }
    for (const key of ['transcriptCompletedMs', 'jevDecisionMs', 'firstAudioDeltaMs', 'responseDoneMs']) {
      const value = input[key];
      if (value === null || (typeof value === 'number' && Number.isFinite(value) &&
          value >= 0 && value <= 600_000)) {
        fields[key] = value;
      }
    }
    if (Array.isArray(input.tools)) {
      fields.tools = input.tools.slice(0, 1_000).flatMap((tool) => {
        if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) return [];
        const item = tool as Record<string, unknown>;
        if (typeof item.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(item.name) ||
            typeof item.startedMs !== 'number' || !Number.isFinite(item.startedMs) ||
            item.startedMs < 0 || item.startedMs > 600_000 ||
            !(item.finishedMs === null || (typeof item.finishedMs === 'number' &&
              Number.isFinite(item.finishedMs) && item.finishedMs >= item.startedMs &&
              item.finishedMs <= 600_000)) ||
            !['ok', 'refused', 'error', 'interrupted'].includes(String(item.outcome))) return [];
        return [{
          name: item.name,
          startedMs: item.startedMs,
          finishedMs: item.finishedMs,
          outcome: item.outcome,
        }];
      });
    }
  }
  if (input.msg === 'pc_bridge.command_timing') {
    if (typeof input.command === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(input.command)) {
      fields.command = input.command;
    }
    if (['ok', 'refused', 'error'].includes(String(input.outcome))) fields.outcome = input.outcome;
    if (typeof input.roundTripMs === 'number' && Number.isFinite(input.roundTripMs) &&
        input.roundTripMs >= 0 && input.roundTripMs <= 600_000) {
      fields.roundTripMs = input.roundTripMs;
    }
  }
  if (input.msg === 'sandbox_heartbeat.decision') {
    if (typeof input.sandboxSessionId === 'string' && /^[1-9]\d{0,18}$/.test(input.sandboxSessionId)) {
      fields.sandboxSessionId = input.sandboxSessionId;
    }
    if (typeof input.invocationId === 'string' && /^[\w.:-]{1,256}$/.test(input.invocationId)) {
      fields.invocationId = input.invocationId;
    }
    if (input.httpStatus === null ||
      (Number.isInteger(input.httpStatus) && Number(input.httpStatus) >= 100 && Number(input.httpStatus) <= 599)) {
      fields.httpStatus = input.httpStatus;
    }
    if (typeof input.decision === 'string' && heartbeatDecisions.has(input.decision)) {
      fields.decision = input.decision;
    }
  }
  if (input.msg === 'task_reconciliation.decision') {
    for (const key of ['taskId', 'sandboxSessionId']) {
      const value = input[key];
      if (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)) fields[key] = value;
    }
    if (typeof input.invocationId === 'string' && /^[\w.:-]{1,256}$/.test(input.invocationId)) {
      fields.invocationId = input.invocationId;
    }
    if (typeof input.status === 'string' && reconciliationStatuses.has(input.status)) fields.status = input.status;
    if (typeof input.decision === 'string' && reconciliationDecisions.has(input.decision)) {
      fields.decision = input.decision;
    }
  }
  if (input.msg === 'voice.upstream_closed' && typeof input.events === 'string' &&
      /^[a-z_.,]{0,400}$/.test(input.events)) {
    fields.events = input.events;
  }
  if (input.msg === 'conversation.reply_failed' || input.msg === 'voice.upstream_error' ||
      input.msg === 'voice.upstream_event_error' || input.msg === 'voice.partials_unavailable' ||
      input.msg === 'voice.upstream_closed' || input.msg === 'voice.connection_failed' ||
      input.msg === 'voice.proactive_context_unavailable' || input.msg === 'voice.credential_refresh_failed') {
    if (input.msg === 'conversation.reply_failed') {
      const cause = sanitizeManagedProviderCause(input.providerCause);
      if (cause) fields.providerCause = cause;
    }
    // Short, fixed-vocabulary diagnostics only: our own error messages and upstream close reasons.
    if (typeof input.failure === 'string' && /^[A-Za-z0-9 .:,'()_-]{1,120}$/.test(input.failure)) {
      fields.failure = input.failure;
    }
    if (typeof input.closeCode === 'number' && Number.isInteger(input.closeCode) &&
        input.closeCode >= 1000 && input.closeCode <= 4999) {
      fields.closeCode = input.closeCode;
    }
    if (typeof input.httpStatus === 'number' && Number.isInteger(input.httpStatus) &&
        input.httpStatus >= 100 && input.httpStatus <= 599) {
      fields.httpStatus = input.httpStatus;
    }
    if (input.language === 'da' || input.language === 'en') fields.language = input.language;
    if (input.msg === 'voice.upstream_event_error') {
      // The upstream error's own type, code and parameter path as short tokens; never its free-text message.
      for (const key of ['errorType', 'errorCode']) {
        const value = input[key];
        if (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value)) fields[key] = value;
      }
      if (typeof input.param === 'string' && /^[A-Za-z0-9_.[\]-]{1,120}$/.test(input.param)) fields.param = input.param;
      if (input.errorCode === 'invalid_function_parameters' && typeof input.upstreamMessage === 'string' &&
          /^[A-Za-z0-9 .:,'()_-]{1,300}$/.test(input.upstreamMessage)) {
        fields.upstreamMessage = input.upstreamMessage;
      }
    }
  }
  if (input.msg === 'voice.reflex_metrics') {
    if (input.language === 'da' || input.language === 'en') fields.language = input.language;
    for (const key of ['partialTranscriptionDeltas', 'speechRecognitionHypotheses', 'stablePartialClauses']) {
      const value = input[key];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000) {
        fields[key] = value;
      }
    }
    for (const key of ['firstActionLatencyMs', 'speechToFirstWordMs', 'speechToFirstAudioMs']) {
      const value = input[key];
      if (value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
        fields[key] = value;
      }
    }
  }
  return fields;
}

export function createLogger(
  config: Pick<BackendConfig, 'logLevel'>,
  telemetry?: TelemetrySink,
  output: NodeJS.WritableStream = process.stdout,
) {
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      const record = JSON.parse(chunk.toString()) as Record<string, unknown>;
      // @fastify/websocket logs outside our literal-event source scan.
      if (record.msg === 'websocket upgrade failed') {
        record.msg = 'connection.upgrade_failed';
        const error = record.err as Record<string, unknown> | undefined;
        Object.assign(record, error?.code === 'ERR_HTTP_SOCKET_ASSIGNED'
          ? { kind: 'protocol' } : safeErrorFields(error));
      }
      const event = typeof record.msg === 'string' && events.has(record.msg) ? record.msg : 'backend.event';
      const level = [10, 20, 30, 40, 50, 60].includes(Number(record.level)) ? Number(record.level) : 30;
      const time = typeof record.time === 'number' && Number.isFinite(record.time) ? record.time : Date.now();
      const sanitized = { level, time, service: 'jarvis-backend', ...safeFields(record), msg: event };
      output.write(JSON.stringify(sanitized) + '\n');
      try {
        const severity = level >= 60 ? 'Critical' : level >= 50 ? 'Error' : level >= 40 ? 'Warning' : level >= 30 ? 'Information' : 'Verbose';
        telemetry?.trackTrace({
          message: event, severity,
          properties: { service: 'jarvis-backend', ...safeFields(record) },
        });
      } catch {
        // A telemetry outage must not break requests or recursively export itself.
        output.write(JSON.stringify({ level: 40, time: Date.now(), service: 'jarvis-backend', msg: 'telemetry.export_failed' }) + '\n');
      }
      done();
    },
  });
  return pino({
    level: config.logLevel,
    base: { service: 'jarvis-backend' },
  }, stream);
}
