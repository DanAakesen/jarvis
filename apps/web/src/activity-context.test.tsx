import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useJarvisActivity } from './activity-context';
import { JarvisActivityProvider } from './activity-provider';

function ActivityProbe() {
  const activity = useJarvisActivity();
  return (
    <>
      <output>{activity.working ? 'working' : 'idle'}</output>
      <button type="button" onClick={() => activity.setWorking('chat-turn', true)}>Start chat</button>
      <button type="button" onClick={() => activity.setWorking('voice-turn', true)}>Start voice</button>
      <button type="button" onClick={() => activity.setWorking('chat-turn', false)}>Finish chat</button>
      <button type="button" onClick={() => activity.setWorking('voice-turn', false)}>Finish voice</button>
    </>
  );
}

describe('JarvisActivityProvider', () => {
  it('keeps the working indicator active until every real activity source finishes', () => {
    render(<JarvisActivityProvider><ActivityProbe /></JarvisActivityProvider>);

    act(() => {
      screen.getByRole('button', { name: 'Start chat' }).click();
      screen.getByRole('button', { name: 'Start voice' }).click();
    });
    expect(screen.getByText('working')).not.toBeNull();

    act(() => screen.getByRole('button', { name: 'Finish chat' }).click());
    expect(screen.getByText('working')).not.toBeNull();

    act(() => screen.getByRole('button', { name: 'Finish voice' }).click());
    expect(screen.getByText('idle')).not.toBeNull();
  });
});
