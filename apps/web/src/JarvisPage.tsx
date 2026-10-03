import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { ActivityPanel } from './ActivityPanel';
import type { NowFeed } from './activity';
import { ConversationHistory } from './ConversationHistory';
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
            <p id="voice-status">
              Voice isn&apos;t available yet. It will show whether Jarvis is listening, thinking or speaking, what
              Jarvis heard and the response latency. You will be able to interrupt by speaking.
            </p>
            <div className="action-row">
              <button className="secondary-button" type="button" disabled aria-describedby="voice-status">Start voice</button>
              <button className="secondary-button" type="button" disabled aria-describedby="voice-status">Mute</button>
            </div>
          </section>
        </section>

        <div className="jarvis-side">
          <ActivityPanel feed={nowFeed} />
          <section className="panel" aria-labelledby="backend-heading">
            <h2 id="backend-heading">Backend</h2>
            <p id="backend-status">
              Whether the backend is awake or asleep isn&apos;t reported yet. The sleep switch will be refused while
              tasks run.
            </p>
            <div className="action-row">
              <button className="secondary-button" type="button" disabled aria-describedby="backend-status">Put the backend to sleep</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
