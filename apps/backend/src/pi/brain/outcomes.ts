/**
 * What the brain reports about itself, in its own fixed words. This file imports nothing at runtime: the log allowlist
 * (`logging.ts`) reads these lists, so the loop and the export boundary cannot drift apart.
 */

/** What one pass of the ticker decided. `idle` and `active_activation` are not here: they never looked at the queue. */
export const brainTickOutcomes = [
  'off', 'paused', 'no_sources', 'empty', 'spaced', 'daily_cap', 'budget_exhausted', 'quiet_hours', 'policy_changed',
  'filtered', 'watches_unavailable', 'done', 'failed',
] as const;
export type BrainTickOutcome = (typeof brainTickOutcomes)[number];

/** Why a sweep or wake ended, or what a wake needed besides the model and could not do: the only reasons `pi.brain` may carry. */
export const brainLogReasons = [
  'done', 'scheduled_done', 'failed', 'cancelled', 'timeout',
  'pi_not_configured', 'pi_budget_exhausted', 'pi_unavailable', 'pi_timeout', 'pi_failed', 'pi_unsupported',
  'background_off', 'paused', 'no_sources', 'daily_cap', 'budget_exhausted', 'quiet_hours', 'policy_changed', 'spaced',
  'satisfied_by_event', 'satisfied_by_recent_activation', 'satisfied_by_active_activation', 'situation_sources_unavailable',
  'inbox_review_failed', 'decision_log_pending', 'budget_notice_failed', 'watches_unavailable', 'spend_record_failed', 'watch_cost_not_recorded', 'feedback_unavailable',
] as const;
export type BrainLogReason = (typeof brainLogReasons)[number];
