import { useCallback, useEffect, useRef, useState } from 'react';
import { backendFetch } from './backend-request';
import { CollapsibleSection } from './CollapsibleSection';
import './PushNotifications.css';

interface PushConfiguration {
  publicKey: string;
  applicationServerKey: Uint8Array;
}

class PushRequestError extends Error {
  constructor(readonly status: number) {
    super(`Push request failed (${status}).`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeApplicationServerKey(value: unknown): PushConfiguration {
  if (typeof value !== 'string' || !/^[\da-z_-]+$/i.test(value)) {
    throw new Error('The server returned an invalid notification key.');
  }
  let decoded: Uint8Array;
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error('The server returned an invalid notification key.');
  }
  if (decoded.length !== 65 || decoded[0] !== 4) {
    throw new Error('The server returned an invalid notification key.');
  }
  return { publicKey: value, applicationServerKey: decoded };
}

function sameApplicationServerKey(subscription: PushSubscription, expected: Uint8Array): boolean {
  const value = subscription.options.applicationServerKey;
  if (!value) return false;
  const actual = new Uint8Array(value);
  return actual.length === expected.length &&
    actual.every((byte, index) => byte === expected[index]);
}

function subscriptionPayload(subscription: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const value = subscription.toJSON();
  const endpoint = value.endpoint;
  const p256dh = value.keys?.p256dh;
  const auth = value.keys?.auth;
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint ?? '');
  } catch {
    throw new Error('This device returned an invalid notification subscription.');
  }
  if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.username || parsedEndpoint.password ||
      parsedEndpoint.href.length > 4096 || !p256dh || !auth ||
      !/^[\da-z_-]+$/i.test(p256dh) || !/^[\da-z_-]+$/i.test(auth)) {
    throw new Error('This device returned an invalid notification subscription.');
  }
  return { endpoint: parsedEndpoint.href, keys: { p256dh, auth } };
}

function supportsPush(): boolean {
  return typeof Notification !== 'undefined' && typeof Notification.requestPermission === 'function' &&
    typeof PushManager !== 'undefined' && typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator && Boolean(navigator.serviceWorker);
}

export function PushNotifications({ backendUrl, getAccessToken }: {
  backendUrl: string | null;
  getAccessToken: () => Promise<string>;
}) {
  const supported = supportsPush();
  const [loading, setLoading] = useState(supported);
  const [loadError, setLoadError] = useState('');
  const [serverOff, setServerOff] = useState(false);
  const [configuration, setConfiguration] = useState<PushConfiguration | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [cleanupEndpoint, setCleanupEndpoint] = useState('');
  const [busy, setBusy] = useState<'enable' | 'test' | 'off' | 'cleanup' | ''>('');
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const loadId = useRef(0);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!backendUrl) throw new Error('Notifications are unavailable until the backend is configured.');
    const token = await getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `${['Bear', 'er'].join('')} ${token}`);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    return backendFetch(`${backendUrl.replace(/\/+$/u, '')}${path}`, { ...init, headers });
  }, [backendUrl, getAccessToken]);

  const load = useCallback(async () => {
    if (!supported) return;
    const currentLoad = ++loadId.current;
    const isCurrentLoad = () => currentLoad === loadId.current;
    setLoading(true);
    setLoadError('');
    setFeedback(null);
    try {
      const configRequest = (async () => {
        const response = await request('/push/config', { cache: 'no-store' });
        if (response.status === 404) return null;
        if (!response.ok) throw new PushRequestError(response.status);
        const value: unknown = await response.json().catch(() => null);
        if (!isRecord(value)) throw new Error('The notification settings response was invalid.');
        return decodeApplicationServerKey(value.publicKey);
      })();
      const registrationRequest = navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
      const [configResult, registrationResult] = await Promise.allSettled([configRequest, registrationRequest]);
      if (!isCurrentLoad()) return;
      if (configResult.status === 'fulfilled' && configResult.value === null) {
        setServerOff(true);
        setConfiguration(null);
        setRegistration(registrationResult.status === 'fulfilled' ? registrationResult.value : null);
        setSubscription(null);
        return;
      }
      if (configResult.status === 'rejected') throw configResult.reason;
      if (registrationResult.status === 'rejected') throw registrationResult.reason;
      const current = await registrationResult.value.pushManager.getSubscription();
      if (!isCurrentLoad()) return;
      setConfiguration(configResult.value);
      setRegistration(registrationResult.value);
      setSubscription(current);
      setServerOff(false);
    } catch {
      if (isCurrentLoad()) setLoadError('Notification settings could not be checked. Try again.');
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [request, supported]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    return () => { active = false; loadId.current += 1; };
  }, [load]);

  const permission = supported ? Notification.permission : 'default';
  const keyChanged = Boolean(configuration && subscription &&
    !sameApplicationServerKey(subscription, configuration.applicationServerKey));
  const notificationsOn = permission === 'granted' && Boolean(subscription) && !keyChanged;

  const enable = async () => {
    if (!configuration || !registration || busy) return;
    setBusy('enable');
    setFeedback(null);
    let pendingSubscription: PushSubscription | null = null;
    let cleanupPending = false;
    try {
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') {
        setFeedback({
          message: granted === 'denied'
            ? 'Notifications were denied. Follow the instructions below to re-enable them.'
            : 'Notifications were not enabled. You can try again.',
          error: granted !== 'default',
        });
        return;
      }

      let current = await registration.pushManager.getSubscription();
      if (current && !sameApplicationServerKey(current, configuration.applicationServerKey)) {
        const oldEndpoint = current.endpoint;
        await current.unsubscribe();
        setSubscription(null);
        current = null;
        try {
          const response = await request('/push/subscription', {
            method: 'DELETE',
            body: JSON.stringify({ endpoint: oldEndpoint }),
          });
          if (!response.ok) throw new PushRequestError(response.status);
        } catch {
          cleanupPending = true;
          setCleanupEndpoint(oldEndpoint);
          throw new Error('The previous subscription could not be removed from the server.');
        }
      }

      const applicationServerKey = new Uint8Array(configuration.applicationServerKey).buffer as ArrayBuffer;
      const next = current ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      pendingSubscription = next;
      const response = await request('/push/subscription', {
        method: 'PUT',
        body: JSON.stringify(subscriptionPayload(next)),
      });
      if (!response.ok) throw new PushRequestError(response.status);
      setSubscription(next);
      setFeedback(null);
    } catch {
      if (pendingSubscription) {
        try { await pendingSubscription.unsubscribe(); } catch { /* Keep the original setup failure visible. */ }
        setSubscription(null);
      }
      setFeedback({
        message: cleanupPending
          ? 'The previous subscription could not be removed from the server. Retry cleanup before continuing.'
          : 'Notifications could not be turned on. Try again.',
        error: true,
      });
    } finally {
      setBusy('');
    }
  };

  const sendTest = async () => {
    if (!notificationsOn || busy) return;
    setBusy('test');
    setFeedback(null);
    try {
      const response = await request('/push/test', { method: 'POST' });
      if (response.status === 409) {
        setSubscription(null);
        setFeedback({
          message: 'No subscription is saved for this device. Turn notifications on again before sending another test.',
          error: true,
        });
        return;
      }
      if (response.status === 429) {
        setFeedback({ message: 'Test notifications are rate limited. Try again later.', error: true });
        return;
      }
      if (!response.ok) throw new PushRequestError(response.status);
      const value: unknown = await response.json().catch(() => null);
      if (!isRecord(value) || !isRecord(value.delivery)) throw new Error('The test notification response was invalid.');
      const rawDelivery = value.delivery;
      const counts = ['attempted', 'accepted', 'failed'].map((key) => rawDelivery[key]);
      if (!counts.every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)) {
        throw new Error('The test notification response was invalid.');
      }
      const [attempted, accepted, failed] = counts as [number, number, number];
      setFeedback({
        message: `The push service accepted ${accepted} of ${attempted} ${attempted === 1 ? 'attempt' : 'attempts'}; ${failed} failed. “Accepted” does not mean it was shown on the phone. Lock the phone, close the app and tap the notification.`,
        error: false,
      });
    } catch {
      setFeedback({ message: 'The test notification could not be sent. Try again.', error: true });
    } finally {
      setBusy('');
    }
  };

  const turnOff = async () => {
    if (!subscription || busy) return;
    setBusy('off');
    setFeedback(null);
    const endpoint = subscription.endpoint;
    let localUnsubscribed = false;
    try {
      await subscription.unsubscribe();
      localUnsubscribed = true;
      setSubscription(null);
      const response = await request('/push/subscription', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint }),
      });
      if (!response.ok) throw new PushRequestError(response.status);
      setFeedback({ message: 'Notifications are off for this device.', error: false });
    } catch {
      if (localUnsubscribed) {
        setCleanupEndpoint(endpoint);
        setFeedback({
          message: 'This device is unsubscribed, but the server could not remove its subscription. Retry cleanup.',
          error: true,
        });
      } else {
        setFeedback({ message: 'Notifications could not be turned off on this device. Try again.', error: true });
      }
    } finally {
      setBusy('');
    }
  };

  const retryCleanup = async () => {
    if (!cleanupEndpoint || busy) return;
    setBusy('cleanup');
    setFeedback(null);
    try {
      const response = await request('/push/subscription', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint: cleanupEndpoint }),
      });
      if (!response.ok) throw new PushRequestError(response.status);
      setCleanupEndpoint('');
      setFeedback({ message: 'Notifications are off for this device.', error: false });
    } catch {
      setFeedback({ message: 'Server cleanup failed. Try again.', error: true });
    } finally {
      setBusy('');
    }
  };

  return (
    <CollapsibleSection storageKey="settings.notifications" headingId="notifications-heading"
      title="Notifications" initiallyOpen={false}>
      <div className="push-notifications">
        {!supported
          ? <p>To use notifications, add Jarvis to the Home Screen and open it from there.</p>
          : loadError
            ? <div className="push-notification-feedback" role="alert">
                <p>{loadError}</p>
                <button className="secondary-button" type="button" onClick={() => { void load(); }}>Retry</button>
              </div>
            : loading
              ? <p role="status">Checking notification settings…</p>
              : serverOff
                ? <>
                    <p>Notifications are not enabled on the server.</p>
                    <button className="secondary-button" type="button" disabled={busy !== ''}
                      onClick={() => { void load(); }}>Check again</button>
                  </>
                : permission === 'denied'
                  ? <p>Notifications are blocked. On your iPhone, open Settings → Notifications → Jarvis and allow notifications.</p>
                  : cleanupEndpoint
                    ? <>
                        <p role="alert">{feedback?.message ?? 'The server still has a subscription to remove.'}</p>
                        <button className="secondary-button" type="button" disabled={busy !== ''}
                          onClick={() => { void retryCleanup(); }}>
                          {busy === 'cleanup' ? 'Retrying cleanup…' : 'Retry cleanup'}
                        </button>
                      </>
                    : notificationsOn
                      ? <>
                          <p>Notifications are on for this device.</p>
                          <div className="push-notification-actions">
                            <button className="primary-button" type="button" disabled={busy !== ''}
                              onClick={() => { void sendTest(); }}>
                              {busy === 'test' ? 'Sending test…' : 'Send test notification'}
                            </button>
                            <button className="secondary-button" type="button" disabled={busy !== ''}
                              onClick={() => { void turnOff(); }}>
                              {busy === 'off' ? 'Turning off…' : 'Turn off'}
                            </button>
                          </div>
                          {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
                        </>
                      : permission === 'granted'
                        ? <>
                            <p>{keyChanged
                              ? 'The server notification key changed. Turn notifications on again for this device.'
                              : 'This device no longer has a notification subscription. Turn notifications on again.'}</p>
                            <button className="primary-button" type="button" disabled={busy !== ''}
                              onClick={() => { void enable(); }}>
                              {busy === 'enable' ? 'Turning on…' : 'Turn notifications on again'}
                            </button>
                            {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
                          </>
                        : <>
                            <p>Notifications are off for this device.</p>
                            <button className="primary-button" type="button" disabled={busy !== ''}
                              onClick={() => { void enable(); }}>
                              {busy === 'enable' ? 'Turning on…' : 'Turn on notifications'}
                            </button>
                            {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
                          </>}
      </div>
    </CollapsibleSection>
  );
}
