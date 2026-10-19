import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushNotifications } from './PushNotifications';

const backendUrl = 'https://api.example.com';
const keyBytes = Uint8Array.from({ length: 65 }, (_value, index) => index === 0 ? 4 : index);
const publicKey = btoa(String.fromCharCode(...keyBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const oldKeyBytes = Uint8Array.from(keyBytes, (byte, index) => index === 1 ? byte + 1 : byte);
const itemId = '11111111-1111-4111-8111-111111111111';

let permission: NotificationPermission;
let localSubscription: PushSubscription | null;
let registration: ServiceWorkerRegistration;
let serviceWorker: { register: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let networkOrder: string[];
let requestPermission: ReturnType<typeof vi.fn>;
let subscription: ReturnType<typeof makeSubscription>;

function makeSubscription(bytes: Uint8Array = keyBytes) {
  const serverKey = new Uint8Array(bytes).buffer as ArrayBuffer;
  const value = {
    endpoint: 'https://push.example.invalid/subscriptions/one',
    options: { applicationServerKey: serverKey },
    toJSON: () => ({
      endpoint: 'https://push.example.invalid/subscriptions/one',
      keys: { p256dh: 'cHVi', auth: 'YXV0aA' },
    }),
    unsubscribe: vi.fn(async () => {
      localSubscription = null;
      return true;
    }),
  };
  return value as unknown as PushSubscription;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

function openSection() {
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
}

function renderSettings() {
  return render(<PushNotifications backendUrl={backendUrl} getAccessToken={async () => 'fixture-token'} />);
}

beforeEach(() => {
  permission = 'default';
  localSubscription = null;
  networkOrder = [];
  requestPermission = vi.fn(async () => {
    networkOrder.push('permission');
    permission = 'granted';
    return permission;
  });
  vi.stubGlobal('Notification', {
    get permission() { return permission; },
    requestPermission,
  } as unknown as typeof Notification);
  vi.stubGlobal('PushManager', class {});
  subscription = makeSubscription();
  const pushManager = {
    getSubscription: vi.fn(async () => localSubscription),
    subscribe: vi.fn(async () => {
      localSubscription = subscription;
      return subscription;
    }),
  };
  registration = { pushManager } as unknown as ServiceWorkerRegistration;
  serviceWorker = { register: vi.fn(async () => registration) };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorker,
  });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    networkOrder.push(`${method} ${url.pathname}`);
    if (url.pathname === '/push/config') return jsonResponse({ publicKey });
    if (url.pathname === '/push/subscription') return emptyResponse();
    if (url.pathname === '/push/test') {
      return jsonResponse({ itemId, delivery: { attempted: 1, accepted: 1, failed: 0 } });
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('push notification settings', () => {
  it('starts folded, prefetches the authenticated config and worker, and prompts before setup writes', async () => {
    const user = userEvent.setup();
    renderSettings();
    const toggle = screen.getByRole('button', { name: 'Notifications' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `${backendUrl}/push/config`,
      expect.objectContaining({ headers: expect.any(Headers), cache: 'no-store' }),
    ));

    openSection();
    await screen.findByRole('button', { name: 'Turn on notifications' });
    networkOrder = [];
    await user.click(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findAllByText('Notifications are on for this device.')).toHaveLength(1);

    expect(networkOrder[0]).toBe('permission');
    expect(networkOrder.indexOf('permission')).toBeLessThan(networkOrder.indexOf('PUT /push/subscription'));
    expect(fetchMock).toHaveBeenCalledWith(`${backendUrl}/push/subscription`, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        endpoint: 'https://push.example.invalid/subscriptions/one',
        keys: { p256dh: 'cHVi', auth: 'YXV0aA' },
      }),
    }));
  });

  it('shows the Home Screen guidance without registration or requests when unsupported', () => {
    vi.stubGlobal('Notification', undefined);
    vi.stubGlobal('PushManager', undefined);
    Reflect.deleteProperty(navigator, 'serviceWorker');
    renderSettings();
    openSection();
    expect(screen.getByText('To use notifications, add Jarvis to the Home Screen and open it from there.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serviceWorker.register).not.toHaveBeenCalled();
  });

  it('shows a disabled server-off state and allows a status retry', async () => {
    fetchMock.mockImplementationOnce(async () => {
      networkOrder.push('GET /push/config');
      return emptyResponse(404);
    }).mockImplementation(async () => jsonResponse({ publicKey }));
    const user = userEvent.setup();
    renderSettings();
    openSection();
    expect(await screen.findByText('Notifications are not enabled on the server.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).not.toBeNull();
  });

  it('shows denied instructions and no permission button', async () => {
    permission = 'denied';
    renderSettings();
    openSection();
    expect(await screen.findByText(/open Settings → Notifications → Jarvis/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
  });

  it('offers setup again when permission remains granted but the local subscription is lost', async () => {
    permission = 'granted';
    renderSettings();
    openSection();
    expect(await screen.findByRole('button', { name: 'Turn notifications on again' })).not.toBeNull();
  });

  it('offers setup again after a server key change and replaces the old local subscription', async () => {
    permission = 'granted';
    localSubscription = makeSubscription(oldKeyBytes);
    const newSubscription = makeSubscription(keyBytes);
    const pushManager = registration.pushManager as unknown as {
      getSubscription: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
    };
    pushManager.getSubscription = vi.fn(async () => localSubscription);
    pushManager.subscribe = vi.fn(async () => {
      localSubscription = newSubscription;
      return newSubscription;
    });
    subscription = newSubscription;

    const user = userEvent.setup();
    renderSettings();
    openSection();
    await user.click(await screen.findByRole('button', { name: 'Turn notifications on again' }));

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true, applicationServerKey: expect.any(ArrayBuffer),
    }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    expect(await screen.findAllByText('Notifications are on for this device.')).toHaveLength(1);
  });

  it('unsubscribes locally and reports a failed subscription write without claiming success', async () => {
    const user = userEvent.setup();
    const attempted = makeSubscription();
    subscription = attempted;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      networkOrder.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/push/config') return jsonResponse({ publicKey });
      if (path === '/push/subscription' && init?.method === 'PUT') return jsonResponse({ error: 'invalid_subscription' }, 400);
      return emptyResponse();
    });

    renderSettings();
    openSection();
    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Notifications could not be turned on. Try again.');
    expect(attempted.unsubscribe).toHaveBeenCalledOnce();
    expect(screen.queryByText('Notifications are on for this device.')).toBeNull();
  });

  it.each([
    { status: 409, message: 'No subscription is saved for this device.' },
    { status: 429, message: 'Test notifications are rate limited. Try again later.' },
  ])('explains test endpoint status $status', async ({ status, message }) => {
    permission = 'granted';
    localSubscription = makeSubscription();
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/push/config') return jsonResponse({ publicKey });
      if (path === '/push/test') return emptyResponse(status);
      return emptyResponse();
    });
    renderSettings();
    openSection();
    await user.click(await screen.findByRole('button', { name: 'Send test notification' }));
    expect((await screen.findByRole('alert')).textContent).toContain(message);
  });

  it.each([
    { delivery: { attempted: 1, accepted: 1, failed: 0 }, counts: '1 of 1 attempt; 0 failed' },
    { delivery: { attempted: 3, accepted: 2, failed: 1 }, counts: '2 of 3 attempts; 1 failed' },
  ])('shows delivery counts ($counts), the acceptance caveat and the phone test instruction', async ({ delivery, counts }) => {
    permission = 'granted';
    localSubscription = makeSubscription();
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/push/config') return jsonResponse({ publicKey });
      if (path === '/push/test') return jsonResponse({ itemId, delivery });
      return emptyResponse();
    });
    renderSettings();
    openSection();
    await user.click(await screen.findByRole('button', { name: 'Send test notification' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      `The push service accepted ${counts}. “Accepted” does not mean it was shown on the phone. Lock the phone, close the app and tap the notification.`,
    );
  });

  it('turns off this device with a local unsubscribe and authenticated DELETE', async () => {
    permission = 'granted';
    localSubscription = makeSubscription();
    const current = localSubscription;
    const user = userEvent.setup();
    renderSettings();
    openSection();
    await user.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(current!.unsubscribe).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/push/subscription') && init?.method === 'DELETE' &&
      init.body === JSON.stringify({ endpoint: current!.endpoint }))).toBe(true);
    expect((await screen.findByRole('status')).textContent).toContain('Notifications are off for this device.');
  });

  it('provides a retry when setup status cannot be fetched', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error('network unavailable'));
    renderSettings();
    openSection();
    expect((await screen.findByRole('alert')).textContent).toContain('Notification settings could not be checked. Try again.');
    fetchMock.mockImplementation(async () => jsonResponse({ publicKey }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).not.toBeNull();
  });
});
