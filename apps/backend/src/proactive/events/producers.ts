import { createHash } from 'node:crypto';
import type { ActivityAlert } from '../../alerts.js';
import { taskStatusMessage, taskStatusNotification } from '../../factory/task-status-notifications.js';
import type { TaskEventMessage } from '../../factory/task-store.js';
import type { GithubWebhookMapping } from '../../github/webhook-mapping.js';
import type { SourceFact } from '../types.js';
import type { ProactiveEventInput } from './types.js';

function oneLine(value: string, max: number): string {
  return Array.from(value.replace(/\s+/gu, ' ').trim()).slice(0, max).join('');
}

/**
 * Build and deploy results from the GitHub webhook. Pull request, push and check events are left out
 * on purpose: failed workflows already cover broken builds, and stalled repositories are noticed by the
 * timer review. Adding a kind here is the only change a new webhook event needs.
 */
export function githubEvent(mapping: GithubWebhookMapping, now: Date): ProactiveEventInput | undefined {
  if (mapping.kind === 'workflow_run') {
    if (mapping.status !== 'completed') return undefined;
    const result = mapping.conclusion ?? 'unknown';
    return {
      source: 'github', kind: `workflow_run.${result}`,
      dedupeKey: `github:workflow_run:${mapping.repository}:${mapping.id}:${result}`,
      summary: `Workflow "${oneLine(mapping.name, 80)}" ${result} on ${mapping.repository} (${oneLine(mapping.branch, 60)})`,
      detail: {
        repository: mapping.repository, workflow: oneLine(mapping.name, 80), branch: oneLine(mapping.branch, 60),
        trigger: mapping.event, deployment: mapping.deploymentWorkflow === true, runNumber: mapping.runNumber,
      },
      occurredAt: mapping.completedAt ? new Date(mapping.completedAt) : now,
    };
  }
  if (mapping.kind === 'deployment_status') {
    return {
      source: 'github', kind: `deployment_status.${mapping.status}`,
      dedupeKey: `github:deployment_status:${mapping.repository}:${mapping.id}:${mapping.status}`,
      summary: `Deployment to ${oneLine(mapping.environment, 60)} ${mapping.status} on ${mapping.repository}`,
      detail: { repository: mapping.repository, environment: oneLine(mapping.environment, 60) },
      occurredAt: new Date(mapping.at),
    };
  }
  return undefined;
}

/** Activity alerts (budget, deploy, sandbox, credential, task start) reach the queue as they are recorded. */
export function alertEvent(alert: ActivityAlert, now: Date): ProactiveEventInput | undefined {
  // Outreach cards are written through the same alert store; reading them back would loop.
  if (alert.type === 'proactive_outreach') return undefined;
  return {
    source: 'alert', kind: alert.type, dedupeKey: `alert:${alert.dedupeKey}`, summary: oneLine(alert.title, 400),
    detail: alert.link ? { link: alert.link } : {}, occurredAt: now,
  };
}

/**
 * What a Worker (a Factory coding session) reports: it finished, needs attention, was cancelled or opened a pull request.
 * The same four states the chat notification uses, so the brain hears exactly what Dan's chat hears. Other task events are
 * progress noise and stay out of the queue.
 */
export function workerEvent(event: TaskEventMessage, now: Date): ProactiveEventInput | undefined {
  const notification = taskStatusNotification(event);
  if (!notification) return undefined;
  const at = Date.parse(event.at);
  return {
    source: 'worker', kind: `task.${notification.state.replace(/([a-z])([A-Z])/gu, '$1_$2').toLowerCase()}`,
    dedupeKey: `worker:${event.taskId}:${notification.state}`,
    summary: oneLine(taskStatusMessage(event.taskId, notification.state, notification.url), 400),
    detail: { taskId: event.taskId, state: notification.state, ...(notification.url ? { pullRequestUrl: notification.url } : {}) },
    occurredAt: Number.isFinite(at) ? new Date(at) : now,
  };
}

/**
 * A source fact becomes an event keyed by what it says. The same mail or calendar entry keeps its key
 * between polls; a changed time or text makes a new key, which is how a change reaches the queue.
 */
export function factEvent(source: 'mail' | 'calendar', fact: SourceFact, now: Date): ProactiveEventInput {
  const fingerprint = createHash('sha256').update(JSON.stringify([
    source, fact.identity ?? null, fact.text, fact.startsAt ?? null, fact.endsAt ?? null, fact.dueAt ?? null,
  ])).digest('hex').slice(0, 40);
  const detail: Record<string, unknown> = {};
  if (fact.startsAt) detail.startsAt = fact.startsAt;
  if (fact.endsAt) detail.endsAt = fact.endsAt;
  if (fact.allDay !== undefined) detail.allDay = fact.allDay;
  const observed = Date.parse(fact.observedAt);
  return {
    source, kind: source === 'mail' ? 'message.new' : 'event.new_or_changed',
    dedupeKey: `${source}:${fingerprint}`,
    summary: oneLine(`${fact.label}: ${fact.text}`, 400),
    detail,
    // Calendar entries are about the future; the change itself just happened.
    occurredAt: source === 'mail' && Number.isFinite(observed) ? new Date(observed) : now,
  };
}
