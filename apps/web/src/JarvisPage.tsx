import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { useCallback, useEffect, useState } from 'react';
import { ConversationHistory } from './ConversationHistory';
import { ConversationToast } from './ConversationToast';
import type { CameraController, ScreenShareController } from './screen-sharing';
import { useThemePreference } from './theme-preference-context';
import { useJarvisActivity } from './activity-context';
import './ConversationHistory.css';

export function JarvisPage({
  client,
  config,
  camera,
  screenShare,
  docked = false,
  onDismiss,
}: {
  /** Off the home page the chat bar is tucked into the rail and cannot be reached until it pops out. */
  docked?: boolean;
  /** Escape tucks a popped-out chat bar back into the rail. */
  onDismiss?: () => void;
  client: PublicClientApplication;
  config: PublicConfig;
  camera: CameraController;
  screenShare: ScreenShareController;
}) {
  const themePreference = useThemePreference();
  const { refreshAppearance, retry: retryTheme } = themePreference;
  const { latestActivity } = useJarvisActivity();
  const [dismissedThemeError, setDismissedThemeError] = useState('');
  const themeError = themePreference.error && themePreference.error !== dismissedThemeError ? themePreference.error : '';
  const dismissThemeError = useCallback(() => setDismissedThemeError(themePreference.error), [themePreference.error]);
  useEffect(() => {
    if (latestActivity?.type === 'tool-call-finished' &&
        latestActivity.toolName === 'set_theme' && latestActivity.outcome === 'ok') {
      void refreshAppearance();
    }
  }, [latestActivity, refreshAppearance]);
  return (
    <div className="jarvis-page" inert={docked} aria-label="Jarvis chat" role="region" onKeyDown={(event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !onDismiss) return;
      event.preventDefault();
      onDismiss();
    }}>
      <h2 id="conversation-heading" className="visually-hidden">Conversation</h2>
      {themeError && (
        <ConversationToast notification={{ id: 0, message: themeError, error: true }} onDismiss={dismissThemeError}
          action={{ label: 'Retry', onSelect: retryTheme }} />
      )}
      <ConversationHistory
        client={client}
        config={config}
        screenShare={screenShare}
        camera={camera}
      />
    </div>
  );
}
