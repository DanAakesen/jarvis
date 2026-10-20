import { describe, expect, it } from 'vitest';
import { dailyQuerySources as sources } from '@jarvis/contracts';
import { dailyFixture } from '../../test-support';
import { sourceCoverage } from './coverage';

describe('source coverage evidence', () => {
  it('selects the newest completed feed, independent of receipt, heartbeat and read time', () => {
    const result = dailyFixture({ source: sources.sync }, [{
      feeds: [
        { feed_kind: 'metrics', processed_committed_at: '2026-10-19T07:00:00Z' },
        { feed_kind: 'workouts', processed_committed_at: '2026-10-20T07:00:00Z', accepted_evidence_at: '2026-10-20T09:00:00Z' },
      ],
      heartbeat: { last_received_at: '2026-10-20T10:00:00Z' },
    }]);
    expect(sourceCoverage(result, false)[0]).toMatchObject({ status: 'Synced', at: '2026-10-20T07:00:00Z' });
    expect(sourceCoverage(result, true)[0]).toMatchObject({ status: 'Stale', at: '2026-10-20T07:00:00Z' });
  });

  it('keeps absent results and empty rows explicitly disconnected with unknown times', () => {
    for (const result of [undefined, dailyFixture({ source: sources.sync }), dailyFixture({ source: sources.sync }, [{}])]) {
      for (const row of sourceCoverage(result, false)) expect(row).toMatchObject({ status: 'Not connected', at: null });
    }
  });
});
