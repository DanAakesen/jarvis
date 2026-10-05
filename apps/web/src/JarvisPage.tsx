import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { BackendSleepControl } from './BackendSleepControl';
import { ConversationHistory } from './ConversationHistory';
import { NowFeedPanel } from './NowFeedPanel';
import { ScreenShareControls } from './ScreenShareControls';
import { useScreenShare } from './screen-sharing';
import './ConversationHistory.css';

export function JarvisPage({
  name,
  client,
  config,
  getAccessToken,
}: {
  name: string;
  client: PublicClientApplication;
  config: PublicConfig;
  getAccessToken: () => Promise<string>;
}) {
  const screenShare = useScreenShare(config, getAccessToken);
  return (
    <div className="jarvis-page">
      <h1 className="visually-hidden">Welcome, {name}</h1>
      <h2 id="conversation-heading" className="conversation-title">Conversation</h2>
      <ConversationHistory client={client} config={config} screenShare={screenShare}>
        <ScreenShareControls screenShare={screenShare} />
        <details className="conversation-overview">
          <summary>Activity and backend</summary>
          <div className="jarvis-side">
            <NowFeedPanel client={client} config={config} getAccessToken={getAccessToken} />
            <section className="panel" aria-labelledby="backend-heading">
              <h2 id="backend-heading">Backend</h2>
              <BackendSleepControl client={client} config={config} />
            </section>
          </div>
        </details>
      </ConversationHistory>
    </div>
  );
}
