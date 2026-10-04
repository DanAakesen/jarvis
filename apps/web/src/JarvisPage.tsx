import { useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { BackendSleepControl } from './BackendSleepControl';
import { ConversationHistory } from './ConversationHistory';
import { NowFeedPanel } from './NowFeedPanel';
import { VoiceControls } from './VoiceControls';
import { ScreenShareControls } from './ScreenShareControls';
import { useScreenShare, type CameraController } from './screen-sharing';
import './ConversationHistory.css';

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
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const screenShare = useScreenShare(config, getAccessToken);
  return (
    <div className="jarvis-page">
      <h1>Welcome, {name}</h1>
      <div className="jarvis-layout">
        <section className="panel" aria-labelledby="conversation-heading">
          <h2 id="conversation-heading">Conversation</h2>
          <p id="conversation-status">
            Chat messages are saved across sessions. Jarvis streams each reply; if a reply is interrupted, check task
            status before sending another request.
          </p>
          <ScreenShareControls screenShare={screenShare} />
          <ConversationHistory client={client} config={config} historyRefresh={historyRefresh} screenShare={screenShare} camera={camera} />

          <section aria-labelledby="voice-heading">
            <h3 id="voice-heading">Voice</h3>
            <p>Speak to Jarvis through a live voice session. You can interrupt Jarvis by speaking.</p>
            <VoiceControls
              client={client}
              config={config}
              screenShare={screenShare}
              camera={camera}
              onSessionEnded={() => {
                screenShare.stop();
                camera.stop();
                setHistoryRefresh((value) => value + 1);
              }}
            />
          </section>
        </section>

        <div className="jarvis-side">
          <NowFeedPanel client={client} config={config} getAccessToken={getAccessToken} />
          <section className="panel" aria-labelledby="backend-heading">
            <h2 id="backend-heading">Backend</h2>
            <BackendSleepControl client={client} config={config} />
          </section>
        </div>
      </div>
    </div>
  );
}
