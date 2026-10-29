import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationMoreMenu } from '../src/ConversationMoreMenu';
import { RuntimeTestSelector } from '../src/RuntimeTestSelector';
import { RuntimeTestConversation } from '../src/RuntimeTestConversation';
import { createChatSession, type RuntimeTestSession } from '../src/conversation-history';
import '../src/styles.css';
const token = async () => 'synthetic-browser-token';
const config = { ...__JARVIS_CONFIG__, backendUrl: 'https://runtime-test.invalid' };
function Fixture() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<RuntimeTestSession | null>(null);
  return <main style={{ padding: 24 }}>
    <p>Synthetic browser inspection. No live runtime calls.</p>
    <div style={{ position: 'fixed', bottom: 24, left: 24 }}><ConversationMoreMenu onTestRuntime={() => setOpen(true)} /></div>
    {open && <RuntimeTestSelector availability={{ current: { available: true }, copilot: { available: false, reason: 'The selected settings have not been verified for Copilot.' } }}
      onClose={() => setOpen(false)} onStart={async runtime => { const created = await createChatSession(token, config, 'en', undefined, runtime); setSession({ ...created, runtimeTest: runtime }); }} />}
    {session && <RuntimeTestConversation session={session} config={config} getAccessToken={token} onClose={() => setSession(null)} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
