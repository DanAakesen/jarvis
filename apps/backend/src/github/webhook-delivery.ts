import type { GithubWebhookMapping } from './webhook-mapping.js';

export type WebhookDeliveryOutcome = 'ok' | 'ignored';

export interface WebhookDeliveryInput {
  readonly deliveryId: string;
  readonly event: string;
  readonly outcome: WebhookDeliveryOutcome;
  readonly mapping?: GithubWebhookMapping;
}

export interface WebhookDeliveryStore {
  record(input: WebhookDeliveryInput): Promise<boolean>;
  recordPullRequest(mapping: Extract<GithubWebhookMapping, { kind: 'pull_request' }>): Promise<void>;
}
