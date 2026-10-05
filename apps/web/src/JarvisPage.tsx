import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { flushSync } from 'react-dom';
import { useCallback, useEffect } from 'react';
import type { WorkspaceCommand } from '@jarvis/contracts';
import { BackendSleepControl } from './BackendSleepControl';
import { ConversationHistory } from './ConversationHistory';
import { JarvisStage } from './JarvisStage';
import { NowFeedPanel } from './NowFeedPanel';
import { ScreenShareControls } from './ScreenShareControls';
import { useScreenShare, type CameraController } from './screen-sharing';
import { useThemePreference } from './theme-preference-context';
import { useJarvisActivity } from './activity-context';
import './ConversationHistory.css';
import { useWorkspaceCommands } from './workspace-command-state';

export function JarvisPage({
  name,
  client,
  config,
  getAccessToken,
  camera,
}: {
  name: string;
  client: PublicClientApplication;
  config: PublicConfig;
  getAccessToken: () => Promise<string>;
  camera: CameraController;
}) {
  const themePreference = useThemePreference();
  const { resolvedTheme, refreshAppearance } = themePreference;
  const { latestActivity } = useJarvisActivity();
  const screenShare = useScreenShare(config, getAccessToken);
  const workspace = useWorkspaceCommands();
  const applyWorkspaceCommand = useCallback((command: WorkspaceCommand, trustedBlobHost?: string) => {
    let applied = false;
    flushSync(() => { applied = workspace.dispatch(command, trustedBlobHost); });
    return applied;
  }, [workspace]);
  useEffect(() => {
    if (latestActivity?.type === 'tool-call-finished' &&
        latestActivity.toolName === 'set_theme' && latestActivity.outcome === 'ok') {
      void refreshAppearance();
    }
  }, [latestActivity, refreshAppearance]);
  return (
    <div className="jarvis-page">
      <JarvisStage theme={resolvedTheme} appearance={themePreference.appearance}>
        <h1 className="visually-hidden">Welcome, {name}</h1>
        <h2 id="conversation-heading" className="visually-hidden">Conversation</h2>
        {themePreference.error && <p className="theme-update-error" role="alert">{themePreference.error}</p>}
        <ConversationHistory
          client={client}
          config={config}
          screenShare={screenShare}
          camera={camera}
          motionReduced={themePreference.appearance.motion === 'reduced'}
        >
          <details className="conversation-overview">
            <summary>Activity, sharing and backend</summary>
            <div className="jarvis-side">
              <ScreenShareControls screenShare={screenShare} />
              <NowFeedPanel
                client={client}
                config={config}
                getAccessToken={getAccessToken}
                applyWorkspaceCommand={applyWorkspaceCommand}
              />
              <section className="panel" aria-labelledby="backend-heading">
                <h2 id="backend-heading">Backend</h2>
                <BackendSleepControl client={client} config={config} />
              </section>
            </div>
          </details>
        </ConversationHistory>
      </JarvisStage>
    </div>
  );
}
