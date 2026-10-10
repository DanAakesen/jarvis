import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

  it('keeps sign-in to its personal greeting and provider-accessible action', () => {
    const signIn = readFileSync('src/pages.tsx', 'utf8');
    expect(signIn).toContain('getSignInGreeting');
    expect(signIn).toContain('aria-label="Sign in with Microsoft"');
    expect(signIn).not.toContain('Jarvis is taking shape');
    expect(signIn).not.toContain('Your personal AI platform starts here.');
    expect(signIn).not.toContain('Not signed in.');
  });
});
