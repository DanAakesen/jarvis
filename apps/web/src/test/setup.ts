import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetPresenceForTests } from '../presence-store';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.removeItem('jarvis.windows.tasks');
  resetPresenceForTests();
});
