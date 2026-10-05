import { useEffect, useRef, useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { ActivityPanel } from './ActivityPanel';
import type { NowFeed, NowFeedStreamStatus } from './activity';
import {
  dismissNowActivity,
  loadNowFeed,
  resolveNowConfirmation,
  streamNowFeed,
} from './now-feed';

export function NowFeedPanel({
  client,
  config,
  getAccessToken,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  getAccessToken: () => Promise<string>;
}) {
  const [feed, setFeed] = useState<NowFeed>({ status: 'loading' });
  const [streamStatus, setStreamStatus] = useState<NowFeedStreamStatus>(
    config.backendUrl ? 'connecting' : 'unavailable',
  );
  const [retry, setRetry] = useState(0);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let requestNumber = 0;
    const refresh = async () => {
      const currentRequest = ++requestNumber;
      try {
        if (!config.backendUrl) throw new Error('Activity is unavailable until the backend is deployed.');
        const result = await loadNowFeed(config.backendUrl, getAccessToken, controller.signal);
        if (active && currentRequest === requestNumber) setFeed(result);
      } catch (error) {
        if (active && currentRequest === requestNumber) {
          setFeed({
            status: 'unavailable',
            message: error instanceof Error ? error.message : 'Jarvis could not load current activity.',
          });
        }
      }
    };
    refreshRef.current = refresh;
    void refresh();

    if (config.backendUrl) {
      void streamNowFeed({
        backendUrl: config.backendUrl,
        getAccessToken,
        onUpdate: () => { void refresh(); },
        onStatus: setStreamStatus,
        signal: controller.signal,
      }).catch(() => {
        if (active) setStreamStatus('unavailable');
      });
    }

    return () => {
      active = false;
      controller.abort();
      refreshRef.current = null;
    };
  }, [client, config, getAccessToken, retry]);

  async function dismiss(id: string) {
    if (!config.backendUrl) throw new Error('Activity dismissal is unavailable.');
    await dismissNowActivity(config.backendUrl, id, getAccessToken);
    await refreshRef.current?.();
  }

  async function resolveConfirmation(id: string, decision: 'approve' | 'reject') {
    if (!config.backendUrl) throw new Error('Browser approvals are unavailable.');
    await resolveNowConfirmation(config.backendUrl, id, decision, getAccessToken);
    void refreshRef.current?.();
  }

  function retryLoad() {
    setFeed({ status: 'loading' });
    setRetry((value) => value + 1);
  }

  return (
    <ActivityPanel
      feed={feed}
      {...(config.backendUrl ? { onDismiss: dismiss } : {})}
      {...(config.backendUrl ? { onResolveConfirmation: resolveConfirmation } : {})}
      onRetry={retryLoad}
      streamStatus={config.backendUrl ? streamStatus : 'unavailable'}
    />
  );
}
