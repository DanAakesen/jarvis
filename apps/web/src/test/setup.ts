import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetPresenceForTests } from '../presence-store';
import { resetJobsForTests } from '../jobs-store';

// A loaded CI runner can stall a worker for longer than the 1 s default, failing waits whose assertion is about to hold.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.removeItem('jarvis.windows.tasks');
  resetPresenceForTests();
  resetJobsForTests();
});
