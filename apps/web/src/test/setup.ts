import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// A loaded CI runner can stall a worker for longer than the 1 s default.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
