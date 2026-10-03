import { ActivityPanel } from './ActivityPanel';
import type { NowFeed } from './activity';

const nowFeed: NowFeed = {
  status: 'unavailable',
  message: "Activity isn't available yet. Running tasks, tasks that need attention, releases, deployments and credential warnings will appear here.",
};

export function JarvisPage({ name }: { name: string }) {
  return (
    <div className="jarvis-page">
      <h1>Welcome, {name}</h1>
      <div className="jarvis-layout">
        <section className="panel" aria-labelledby="conversation-heading">
          <h2 id="conversation-heading">Conversation</h2>
          <p id="conversation-status">
            Chat isn&apos;t connected yet. Your messages and Jarvis&apos;s replies, with their time, language and
            tool calls linked to tasks, will appear here.
          </p>
          <form className="composer" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="message">Message Jarvis</label>
            <textarea id="message" name="message" rows={3} disabled aria-describedby="conversation-status" />
            <div className="action-row">
              <button className="primary-button" type="submit" disabled aria-describedby="conversation-status">Send</button>
            </div>
          </form>

          <fieldset className="choice-group">
            <legend>Language</legend>
            <p id="language-status" className="hint">Switching between Danish and English arrives with chat and voice.</p>
            <label className="choice">
              <input type="radio" name="language" value="da" disabled aria-describedby="language-status" /> Danish
            </label>
            <label className="choice">
              <input type="radio" name="language" value="en" disabled aria-describedby="language-status" /> English
            </label>
          </fieldset>

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
