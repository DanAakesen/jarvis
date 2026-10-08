import { publishPresenceMode } from './presence-store';
import { publishJob } from './jobs-store';
import { publishVoiceWake } from './wake-store';
import { useContext, useEffect, useRef, useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import { useJarvisActivity } from './activity-context';
import type { PublicConfig } from '../config/public-config';
import type { WorkspaceCommand } from '@jarvis/contracts';
import { ActivityPanel } from './ActivityPanel';
import { WorkspaceCommandContext } from './workspace-command-state';
import type { NowFeed, NowFeedStreamStatus } from './activity';
import {
  dismissNowActivity,
  acknowledgeWorkspaceCommand,
  loadNowFeed,
  resolveNowConfirmation,
  streamNowFeed,
  publishWorkspaceSnapshot,
} from './now-feed';

export function NowFeedPanel({
  client,
  config,
  getAccessToken,
  applyWorkspaceCommand,
}: {
  client: PublicClientApplication;
  config: PublicConfig;
  getAccessToken: () => Promise<string>;
  applyWorkspaceCommand: (command: WorkspaceCommand, trustedBlobHost?: string) => boolean;
}) {
  const { applyRuntimeActivity, clearRuntimeActivities } = useJarvisActivity();
  const [feed, setFeed] = useState<NowFeed>({ status: 'loading' });
  const [streamStatus, setStreamStatus] = useState<NowFeedStreamStatus>(
    config.backendUrl ? 'connecting' : 'unavailable',
  );
  const [retry, setRetry] = useState(0);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const applyWorkspaceCommandRef = useRef(applyWorkspaceCommand);
  const workspace = useContext(WorkspaceCommandContext);
  const [workspaceSession, setWorkspaceSession] = useState<string | null>(null);
  const snapshotQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (!config.backendUrl || !workspaceSession || !workspace?.snapshot) return;
    const controller = new AbortController();
    snapshotQueue.current = snapshotQueue.current.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return;
      await publishWorkspaceSnapshot(config.backendUrl!, workspaceSession, workspace.snapshot!, getAccessToken, controller.signal);
    }).catch(() => {
      if (!controller.signal.aborted) setStreamStatus('unavailable');
    });
    return () => controller.abort();
  }, [config.backendUrl, getAccessToken, workspace?.snapshot, workspaceSession]);

  useEffect(() => {
    applyWorkspaceCommandRef.current = applyWorkspaceCommand;
  }, [applyWorkspaceCommand]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let requestNumber = 0;
    let workspaceSessionId: string | null = null;
    let trustedBlobHost: string | undefined;
    let commandQueue = Promise.resolve();
    const cancelledCommands = new Set<string>();
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
        onStatus: (status) => {
          setStreamStatus(status);
          if (status === 'reconnecting') {
            clearRuntimeActivities();
            setWorkspaceSession(null);
          }
        },
        onActivity: applyRuntimeActivity,
        onPresenceMode: publishPresenceMode,
        onJob: publishJob,
        onVoiceWake: publishVoiceWake,
        onWorkspaceReady: (sessionId, blobHost) => {
          workspaceSessionId = sessionId;
          setWorkspaceSession(sessionId);
          trustedBlobHost = blobHost;
        },
        onWorkspaceCommand: (command, expiresAt, commandBlobHost) => {
          commandQueue = commandQueue.then(async () => {
            if (!active || !config.backendUrl || !workspaceSessionId) return;
            let applied = false;
            let outcome: 'refused' | 'error' = 'refused';
            let reason: string | undefined;
            if (cancelledCommands.delete(command.commandId)) {
              reason = 'The workspace command was cancelled before application.';
            } else if (expiresAt <= Date.now()) {
              reason = 'The workspace command expired before application.';
            } else {
              try {
                applied = applyWorkspaceCommandRef.current(command, commandBlobHost ?? trustedBlobHost);
                if (!applied) reason = 'The requested view or workspace operation is no longer available.';
              } catch {
                outcome = 'error';
                reason = 'The workspace failed while applying the command.';
              }
            }
            try {
              await acknowledgeWorkspaceCommand(
                config.backendUrl,
                command.commandId,
                workspaceSessionId,
                applied,
                getAccessToken,
                applied ? undefined : outcome,
                reason,
              );
            } catch {
              if (!active) return;
            }
          }).catch(() => {});
        },
        onWorkspaceCancel: (commandId) => {
          cancelledCommands.add(commandId);
          if (cancelledCommands.size > 8) {
            const oldest = cancelledCommands.values().next().value as string | undefined;
            if (oldest) cancelledCommands.delete(oldest);
          }
        },
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
  }, [applyRuntimeActivity, clearRuntimeActivities, client, config, getAccessToken, retry]);

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
