import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAlertNotifier } from './alerts.js';

describe('application alert telemetry', () => {
  it('publishes only the alert type and a one-way condition key', () => {
    const telemetry = { trackTrace: vi.fn(), flush: vi.fn(), shutdown: vi.fn() };
    const notify = createAlertNotifier(telemetry);

    notify({ type: 'deployment_failure', dedupeKey: 'deployment:12345' });

    expect(telemetry.trackTrace).toHaveBeenCalledOnce();
    expect(telemetry.trackTrace).toHaveBeenCalledWith({
      message: 'jarvis.alert',
      severity: 'Warning',
      properties: {
        alertType: 'deployment_failure',
        alertKey: createHash('sha256').update('deployment:12345').digest('hex'),
      },
    });
    expect(JSON.stringify(telemetry.trackTrace.mock.calls)).not.toContain('deployment:12345');
  });

  it('does not require or create telemetry when it is not configured', () => {
    expect(() => createAlertNotifier()({ type: 'sandbox_crash', dedupeKey: 'sandbox:9' })).not.toThrow();
  });
});
