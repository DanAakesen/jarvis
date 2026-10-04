export type WebhookDeliveryOutcome = 'ok' | 'ignored';

export interface WebhookDeliveryInput {
  readonly deliveryId: string;
  readonly event: string;
  readonly outcome: WebhookDeliveryOutcome;
}

export interface WebhookDeliveryStore {
  record(input: WebhookDeliveryInput): Promise<boolean>;
}
