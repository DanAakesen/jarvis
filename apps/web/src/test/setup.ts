import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetPresenceForTests } from '../presence-store';
import { resetJobsForTests } from '../jobs-store';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.removeItem('jarvis.windows.tasks');
  resetPresenceForTests();
  resetJobsForTests();
});
