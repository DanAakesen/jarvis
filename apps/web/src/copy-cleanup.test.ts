import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const productionSource = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .filter((path) => /\.(ts|tsx)$/u.test(path) && !/\.test\.(ts|tsx)$/u.test(path))
  .map((path) => readFileSync(`src/${path}`, 'utf8'))
  .join('\n');

const sources = [
  'src/MobileShell.tsx',
  'src/ToolCallChip.tsx',
  'src/ConversationHistory.tsx',
  'src/Workspace.tsx',
  'src/conversation-history.ts',
  'src/jobs-store.ts',
  'src/page-navigation.ts',
  'src/screen-sharing.ts',
  'src/voice-client.ts',
  'src/VoiceControls.tsx',
  'src/Presence.tsx',
  'src/TaskRecipesSettings.tsx',
  'src/SettingsPage.tsx',
  'src/factory/TaskDetailPage.tsx',
  'src/factory/TaskReleaseBar.tsx',
  'src/factory/TasksPage.tsx',
  'src/MemorySettings.tsx',
  'src/knowledge/KnowledgeGraphView.tsx',
].map((path) => readFileSync(path, 'utf8')).join('\n');

describe('production interface copy', () => {
  it('does not ship the named explainer, prompt, or development strings', () => {
    for (const copy of [
      'You can also ask Jarvis to take you anywhere.',
      'Need something looked up?',
      'Draft, fix or find something?',
      'Plan it, research it, remember it…',
      'Projects are unavailable until the backend is deployed.',
      'Show a sample graph (development only)',
      'Chat is unavailable until the backend is deployed.',
      'Jobs are unavailable until the backend is deployed.',
      'Voice is unavailable until the backend is configured.',
      'Conversation history is unavailable until the backend is deployed.',
      'Image artifacts are unavailable until the backend is deployed.',
      'Visual inspection is unavailable until the backend is configured.',
      'The ${page} page is not available yet.',
      'No task recipes saved yet.',
      'Task recipes',
      'task recipes',
      'No credential status has been recorded yet.',
      'Pull-request links are not reported until the GitHub integration is available.',
      'Select an active project to load release context.',
      'If a reply is interrupted, check the conversation and task status before sending again.',
      'Make a plan, explore an idea, or pick up where you left off.',
      'Turn on camera in More to ask Jarvis to look.',
      'Share screen in More to ask Jarvis to look.',
      'You are at the screen.',
      'You are not at the screen.',
      'You are out with your phone.',
      'All repositories in the GitHub App installation are managed.',
    ]) {
      expect(sources).not.toContain(copy);
    }
    expect(readFileSync('src/ConversationHistory.tsx', 'utf8')).toContain('Ask Jarvis');
  });

  it('keeps explainer paragraphs that only restate the obvious out of every page', () => {
    for (const copy of [
      'Typed text and page content are not stored.',
      'Secret values are never shown.',
      'Applies to new sessions.',
      'Fixed for Danish voice sessions.',
      'Pausing stops scheduled checks, todo additions and alerts.',
      'This also saves any other changed Settings.',
      'Choose a whole number from 1 to 100.',
      'Up to 10 unique HTTPS feed URLs',
      'Unsaved project defaults.',
      'Archiving hides this project from active lists.',
      'Sandbox cost is estimated from session time.',
      'Marker shapes show record type',
      'Browse your recorded workouts, nutrition, body measurements, sleep and briefs.',
      'Your workouts, nutrition, body, sleep and latest brief at a glance.',
      'Upload receipt, successful processing and phone contact are separate evidence.',
      'Retained records are read-only.',
      'Past briefs—not current health or a new delivery.',
      'Briefs will appear here after the first one is recorded.',
      'Recorded activity only. Logging and corrections stay in chat.',
      'Tasks come from checkbox items in your Personal and Work notes.',
    ]) {
      expect(productionSource).not.toContain(copy);
    }
  });

  it('keeps sign-in to its personal greeting and provider-accessible action', () => {
    const signIn = readFileSync('src/pages.tsx', 'utf8');
    expect(signIn).toContain('getSignInGreeting');
    expect(signIn).toContain("aria-label={pending ? 'Redirecting' : 'Sign in with Microsoft'}");
    expect(signIn).not.toContain('Jarvis is taking shape');
    expect(signIn).not.toContain('Your personal AI platform starts here.');
    expect(signIn).not.toContain('Not signed in.');
  });
});
