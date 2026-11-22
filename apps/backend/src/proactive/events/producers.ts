import { createHash } from 'node:crypto';
import type { ActivityAlert } from '../../alerts.js';
import { taskStatusMessage, taskStatusNotification } from '../../factory/task-status-notifications.js';
import type { TaskEventMessage } from '../../factory/task-store.js';
import type { GithubWebhookMapping } from '../../github/webhook-mapping.js';
import { dayKey, localTimeLabel } from '../time.js';
import type { SourceFact } from '../types.js';
import { EVENT_SUMMARY_MAX, type ProactiveEventInput } from './types.js';

/**
 * One line of free text that came from outside. Control, format (zero-width, bidirectional, tag) and line or paragraph
 * separator characters become spaces, as the queue does for a summary, so none reaches the wake through `detail`.
 */
function oneLine(value: string, max: number): string {
  return Array.from(value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/gu, ' ').trim()).slice(0, max).join('');
}

/** The summary column counts UTF-16 units, so clip by units and never split a surrogate pair. */
function summaryLine(value: string): string {
  const line = value.replace(/\s+/gu, ' ').trim();
  return line.length <= EVENT_SUMMARY_MAX
    ? line
    : `${line.slice(0, EVENT_SUMMARY_MAX - 1).replace(/[\uD800-\uDBFF]$/u, '')}…`;
}

/** Copenhagen date and time, the way Dan reads a clock. */
function localStamp(date: Date): string {
  return `${dayKey(date)} ${localTimeLabel(date)}`;
}

/**
 * One GitHub signal. The key is made only of what the payload says, so a redelivery of the same webhook is the
 * same event whatever the summary, detail or clock says. Nothing here decides whether Dan hears about it.
 */
function githubSignal(
  kind: string, key: string, summary: string, detail: Record<string, unknown>, occurredAt: Date,
): ProactiveEventInput {
  const dedupeKey = `github:${key}`;
  return { source: 'github', kind, dedupeKey, material: dedupeKey, summary: summaryLine(summary), detail, occurredAt };
}

/**
 * What the GitHub webhook tells the queue: build and deploy results, and what happens to the tracked repositories
 * (a release, an issue opened, closed or reopened, a comment, a pull request opened, merged or sent for review, a
 * failed check on the default branch). A push is not news on its own and the Jarvis label starts a task instead.
 * A new kind also needs its mapping in `github/webhook-mapping.ts`, its event in `githubWebhookEvents` and the App manifest, and
 * a row in `pi/brain/signals.test.ts`, which runs the real `message_dan` against it.
 */
export function githubEvent(mapping: GithubWebhookMapping, now: Date): ProactiveEventInput | undefined {
  const by = (actor: string | null) => actor ? ` (by ${actor})` : '';
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
  if (mapping.kind === 'release') {
    const name = mapping.name && mapping.name !== mapping.tag ? ` "${oneLine(mapping.name, 100)}"` : '';
    return githubSignal(
      'release.published', `release:${mapping.repository}:${mapping.id}:${mapping.publishedAt}`,
      `${mapping.prerelease ? 'Pre-release' : 'Release'} ${oneLine(mapping.tag, 80)}${name} published on ${mapping.repository}${by(mapping.actor)}`,
      {
        repository: mapping.repository, tag: oneLine(mapping.tag, 80), prerelease: mapping.prerelease,
        ...(mapping.actor ? { actor: mapping.actor } : {}),
      },
      new Date(mapping.publishedAt),
    );
  }
  if (mapping.kind === 'issue') {
    return githubSignal(
      `issues.${mapping.action}`, `issues:${mapping.repository}#${mapping.number}:${mapping.action}:${mapping.at}`,
      `Issue #${mapping.number} ${mapping.action} on ${mapping.repository}: ${oneLine(mapping.title, 150)}${by(mapping.actor)}`,
      { repository: mapping.repository, number: mapping.number, ...(mapping.actor ? { actor: mapping.actor } : {}) },
      new Date(mapping.at),
    );
  }
  if (mapping.kind === 'issue_comment') {
    const what = mapping.pullRequest ? 'pull request' : 'issue';
    return githubSignal(
      'issue_comment.created', `issue_comment:${mapping.repository}:${mapping.id}`,
      `${mapping.commenter ?? 'Someone'} commented on ${what} #${mapping.number} on ${mapping.repository} ("${oneLine(mapping.title, 100)}")${mapping.excerpt ? `: ${oneLine(mapping.excerpt, 150)}` : ''}`,
      {
        repository: mapping.repository, number: mapping.number, pullRequest: mapping.pullRequest,
        ...(mapping.commenter ? { commenter: mapping.commenter } : {}),
      },
      new Date(mapping.at),
    );
  }
  if (mapping.kind === 'pull_request' && mapping.activity) {
    const { activity } = mapping;
    const subject = `#${mapping.number} on ${mapping.repository}: ${oneLine(activity.title, 150)}`;
    const detail = {
      repository: mapping.repository, number: mapping.number, branch: oneLine(mapping.branch, 60),
      ...(activity.actor ? { actor: activity.actor } : {}),
    };
    if (activity.action === 'opened') {
      return githubSignal(
        'pull_request.opened', `pull_request:${mapping.repository}#${mapping.number}:opened`,
        `Pull request ${subject} (${oneLine(mapping.branch, 60)})${by(activity.author)}`,
        detail, new Date(mapping.openedAt),
      );
    }
    if (activity.action === 'closed' && mapping.state === 'merged') {
      const mergedAt = mapping.mergedAt ?? activity.updatedAt;
      return githubSignal(
        'pull_request.closed', `pull_request:${mapping.repository}#${mapping.number}:closed:${mergedAt}`,
        `Pull request ${subject} was merged${by(activity.actor)}`,
        { ...detail, merged: true }, new Date(mergedAt),
      );
    }
    if (activity.action === 'review_requested') {
      return githubSignal(
        'pull_request.review_requested',
        `pull_request:${mapping.repository}#${mapping.number}:review_requested:${activity.reviewer ?? 'unknown'}:${activity.updatedAt}`,
        `Review requested from ${activity.reviewer ?? 'a reviewer'} on pull request ${subject}${by(activity.actor)}`,
        { ...detail, ...(activity.reviewer ? { reviewer: activity.reviewer } : {}) }, new Date(activity.updatedAt),
      );
    }
    return undefined;
  }
  // Only a check that failed on the default branch: failures on a pull request branch belong to that pull request.
  if (mapping.kind === 'check_run') {
    if (mapping.status !== 'completed' || mapping.conclusion !== 'failure' || mapping.id === null ||
        mapping.branch === null || mapping.branch !== mapping.defaultBranch) return undefined;
    return githubSignal(
      'check_run.failure', `check_run:${mapping.repository}:${mapping.id}:failure`,
      `Check "${oneLine(mapping.name ?? 'unnamed', 100)}" failed on ${mapping.repository} (${oneLine(mapping.branch, 60)})`,
      {
        repository: mapping.repository, check: mapping.name === null ? null : oneLine(mapping.name, 100),
        branch: oneLine(mapping.branch, 60), sha: mapping.headSha.slice(0, 12),
      },
      mapping.completedAt ? new Date(mapping.completedAt) : now,
    );
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
  const identity = `${source}:${fact.identity ?? fact.ref}`;
  const material = [
    fact.text, fact.startsAt ?? null, fact.endsAt ?? null, fact.dueAt ?? null,
  ];
  const fingerprint = createHash('sha256').update(JSON.stringify([identity, ...material])).digest('hex').slice(0, 40);
  const detail: Record<string, unknown> = {};
  detail.identity = fact.identity ?? fact.ref;
  detail.ref = fact.ref;
  if (fact.startsAt) detail.startsAt = fact.startsAt;
  if (fact.endsAt) detail.endsAt = fact.endsAt;
  if (fact.allDay !== undefined) detail.allDay = fact.allDay;
  const observed = Date.parse(fact.observedAt);
  return {
    source, kind: source === 'mail' ? 'message.new' : 'event.new_or_changed',
    identity, material,
    dedupeKey: `${source}:${fingerprint}`,
    summary: oneLine(`${fact.label}: ${fact.text}`, 400),
    detail,
    // Calendar entries are about the future; the change itself just happened.
    occurredAt: source === 'mail' && Number.isFinite(observed) ? new Date(observed) : now,
  };
}

/**
 * One event per pair of overlapping timed calendar entries, from the facts the 15-minute poll already read.
 * All-day entries never clash. The pair is keyed by both entries and both time ranges, whichever order the
 * calendar listed them in, so the same clash keeps its key between polls and a moved entry makes a new one.
 * Whether Dan hears about it is not decided here.
 */
export function clashEvents(facts: readonly SourceFact[], now: Date): ProactiveEventInput[] {
  const timed = facts.flatMap((fact) => {
    const start = Date.parse(fact.startsAt ?? '');
    const end = Date.parse(fact.endsAt ?? '');
    return fact.kind === 'event' && fact.allDay !== true && Number.isFinite(start) && Number.isFinite(end) && start < end
      ? [{ id: fact.identity ?? fact.ref, text: fact.text, start, end }] : [];
  });
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40);
  const events: ProactiveEventInput[] = [];
  for (const [index, left] of timed.entries()) {
    for (const right of timed.slice(index + 1)) {
      const overlapStart = Math.max(left.start, right.start);
      const overlapEnd = Math.min(left.end, right.end);
      if (left.id === right.id || overlapStart >= overlapEnd) continue;
      const [first, second] = left.id < right.id ? [left, right] : [right, left];
      const [earlier, later] = left.start < right.start || left.start === right.start && left.id < right.id
        ? [left, right] : [right, left];
      const range = (entry: typeof first) => ({
        ref: entry.id, startsAt: new Date(entry.start).toISOString(), endsAt: new Date(entry.end).toISOString(),
      });
      const [startsAt, endsAt] = [new Date(overlapStart), new Date(overlapEnd)];
      const entries = [range(first), range(second)];
      events.push({
        source: 'calendar', kind: 'calendar.clash',
        identity: `calendar:clash:${hash([first.id, second.id])}`,
        material: entries,
        dedupeKey: `calendar:clash:${hash(entries)}`,
        summary: summaryLine(
          `Calendar clash from ${localStamp(startsAt)} to ${localStamp(endsAt)}: "${oneLine(earlier.text, 100)}" overlaps "${oneLine(later.text, 100)}"`,
        ),
        detail: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), entries },
        // The clash is about the future; finding it just happened.
        occurredAt: now,
      });
    }
  }
  return events;
}

/**
 * An explicit owner reminder whose push delivery ended without reaching a device, after its retries. The reminder is the identity
 * and the due time its material, so one failure is one event and a rescheduled reminder that fails again is a new one.
 * The reminder belongs to a task, so the event rests on the Todos source: it is what the wake can offer as evidence when
 * the brain tells Dan, and Dan's Todos switch governs it like any other source. `evidenceSources` comes first so the wake's
 * clipped `detail=` can never cut it off.
 */
export function reminderFailureEvent(failure: {
  scheduleId: string;
  occurrenceAt: Date;
  title: string;
  reason: string | null;
  providerOutcome: string | null;
  attempts: number;
  recipients: number;
  accepted: number;
}, now: Date): ProactiveEventInput {
  const occurrence = failure.occurrenceAt.toISOString();
  return {
    source: 'reminder', kind: 'reminder.delivery_failed',
    identity: `reminder:${failure.scheduleId}`,
    material: { occurrenceAt: occurrence },
    dedupeKey: `reminder:delivery_failed:${failure.scheduleId}:${occurrence}`,
    summary: summaryLine(
      `Reminder "${oneLine(failure.title, 80)}" due ${localStamp(failure.occurrenceAt)} could not be delivered to a device (${failure.reason ?? 'delivery failed'}) after ${failure.attempts} attempt${failure.attempts === 1 ? '' : 's'}`,
    ),
    detail: {
      evidenceSources: ['todos'],
      reminderId: failure.scheduleId, occurrenceAt: occurrence, reason: failure.reason,
      providerOutcome: failure.providerOutcome, attempts: failure.attempts,
      recipients: failure.recipients, accepted: failure.accepted,
    },
    occurredAt: now,
  };
}
