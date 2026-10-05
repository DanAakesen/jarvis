import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useJarvisActivity } from './activity-context';
import { JarvisActivityProvider } from './activity-provider';

function ActivityProbe() {
  const activity = useJarvisActivity();
  return (
    <>
      <output>{activity.working ? 'working' : 'idle'}</output>
      <output aria-label="Latest runtime activity">{activity.latestActivity?.type ?? 'none'}</output>
      <button type="button" onClick={() => activity.applyRuntimeActivity({
        type: 'thinking', activityId: '11111111-1111-4111-8111-111111111111', source: 'chat',
      })}>Start chat</button>
      <button type="button" onClick={() => activity.applyRuntimeActivity({
        type: 'tool-call-started', activityId: '22222222-2222-4222-8222-222222222222',
        source: 'voice', toolName: 'workspace_command',
      })}>Start voice tool</button>
      <button type="button" onClick={() => activity.applyRuntimeActivity({
        type: 'tool-call-finished', activityId: '22222222-2222-4222-8222-222222222222',
        source: 'voice', toolName: 'workspace_command', outcome: 'refused',
      })}>Finish voice tool</button>
      <button type="button" onClick={() => activity.applyRuntimeActivity({
        type: 'ended', activityId: '11111111-1111-4111-8111-111111111111', source: 'chat',
      })}>Finish chat</button>
      <button type="button" onClick={activity.clearRuntimeActivities}>Clear on reconnect</button>
    </>
  );
}

describe('JarvisActivityProvider', () => {
  it('derives working and terminal status only from runtime activity events', () => {
    render(<JarvisActivityProvider><ActivityProbe /></JarvisActivityProvider>);

    expect(screen.getByText('idle')).not.toBeNull();
    act(() => {
      screen.getByRole('button', { name: 'Start chat' }).click();
    });
    expect(screen.getByText('working')).not.toBeNull();

    act(() => screen.getByRole('button', { name: 'Start voice tool' }).click());
    expect(screen.getByText('working')).not.toBeNull();

    act(() => screen.getByRole('button', { name: 'Finish chat' }).click());
    expect(screen.getByText('working')).not.toBeNull();

    act(() => screen.getByRole('button', { name: 'Finish voice tool' }).click());
    expect(screen.getByText('idle')).not.toBeNull();
    expect(screen.getByLabelText('Latest runtime activity').textContent).toBe('tool-call-finished');

    act(() => screen.getByRole('button', { name: 'Clear on reconnect' }).click());
    expect(screen.getByLabelText('Latest runtime activity').textContent).toBe('none');
  });
});
