import { createHash } from 'node:crypto';
import type { TelemetrySink } from './logging.js';

export type AlertType = 'deployment_failure' | 'sandbox_crash' | 'credential_expiry' | 'budget_threshold';

export interface ActivityAlert {
  type: AlertType;
  dedupeKey: string;
  title: string;
  link: string | null;
}

export type AlertNotifier = (alert: Pick<ActivityAlert, 'type' | 'dedupeKey'>) => void;

export function createAlertNotifier(telemetry?: TelemetrySink): AlertNotifier {
  return ({ type, dedupeKey }) => {
    if (!telemetry) return;
    try {
      telemetry.trackTrace({
        message: 'jarvis.alert',
        severity: 'Warning',
        properties: {
          alertType: type,
          alertKey: createHash('sha256').update(dedupeKey).digest('hex'),
        },
      });
    } catch {
      // Alert persistence must not fail because telemetry is unavailable.
    }
  };
}

export function notifyAlert(notifier: AlertNotifier | undefined, alert: ActivityAlert): void {
  try {
    notifier?.(alert);
  } catch {
    // Alert persistence must not fail because an external notification failed.
  }
}
