import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { ActivityPanel } from './ActivityPanel';
import type { NowFeed } from './activity';
import { BackendSleepControl } from './BackendSleepControl';
import { ConversationHistory } from './ConversationHistory';
import { VoiceControls } from './VoiceControls';
import './ConversationHistory.css';

const nowFeed: NowFeed = {
  status: 'unavailable',
  message: "Activity isn't available yet. Running tasks, tasks that need attention, releases, deployments and credential warnings will appear here.",
};

export function JarvisPage({
  name,
  client,
  config,
}: {
  name: string;
  client: PublicClientApplication;
  config: PublicConfig;
}) {
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
          <ConversationHistory client={client} config={config} />

          <section aria-labelledby="voice-heading">
            <h3 id="voice-heading">Voice</h3>
            <p>Speak to Jarvis through a live voice session. You can interrupt Jarvis by speaking.</p>
            <VoiceControls client={client} config={config} />
          </section>
        </section>

        <div className="jarvis-side">
          <ActivityPanel feed={nowFeed} />
          <section className="panel" aria-labelledby="backend-heading">
            <h2 id="backend-heading">Backend</h2>
            <BackendSleepControl client={client} config={config} />
          </section>
        </div>
      </div>
    </div>
  );
}
