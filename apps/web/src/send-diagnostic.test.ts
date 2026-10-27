import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeSendDiagnostic, readSendDiagnostic } from './send-diagnostic';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture() {
  const form = document.createElement('form');
  const input = document.createElement('textarea');
  input.value = 'PRIVATE draft token photo health';
  const send = document.createElement('button');
  send.type = 'submit';
  send.innerHTML = '<span>PRIVATE button payload</span>';
  form.append(input, send);
  document.body.append(form);
  input.focus();
  return { form, input, send };
}
describe('temporary Send diagnostic', () => {
  it('records allowed metadata only without cancelling or redirecting input', async () => {
    const { input, send, form } = fixture();
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const network = vi.spyOn(window, 'fetch');
    const dispose = observeSendDiagnostic(input, send);
    const submit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submit);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    send.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    send.click();
    await Promise.resolve();
    expect(readSendDiagnostic().some(row => row.phase === 'settled')).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('PRIVATE draft token photo health');
    const trace = readSendDiagnostic();
    await vi.waitFor(() => expect(readSendDiagnostic().some(row => row.event === 'submit' && row.phase === 'settled' && row.prevented)).toBe(true));
    expect(storage).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(trace)).not.toMatch(/PRIVATE|payload|health|photo|token/);
    expect(Object.keys(trace[0]!).sort()).toEqual(['ms', 'event', 'phase', 'target', 'focused', 'prevented', 'disabled', 'pointer', 'viewport', 'button', 'inComposer', 'pathInComposer'].sort());
    dispose();
  });
  it('bounds memory, returns copies and removes listeners and queued work', async () => {
    const { input, send } = fixture();
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const dispose = observeSendDiagnostic(input, send);
    for (let n = 0; n < 300; n++) send.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(readSendDiagnostic()).toHaveLength(128);
    const copy = readSendDiagnostic();
    copy[0]!.button[0] = 999;
    expect(readSendDiagnostic()[0]!.button[0]).not.toBe(999);
    send.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    dispose();
    const count = readSendDiagnostic().length;
    await Promise.resolve();
    send.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(readSendDiagnostic()).toHaveLength(count);
    for (const [type, listener, options] of add.mock.calls) {
      expect(options).toEqual({ capture: true, passive: true });
      expect(remove).toHaveBeenCalledWith(type, listener, options);
    }
  });
});

describe('explicit diagnostic copy', () => {
  it('writes only bounded allowlisted metadata and never reads the clipboard', async () => {
    const { input, send } = fixture();
    const dispose = observeSendDiagnostic(input, send);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readText = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText, readText } });
    for (let i = 0; i < 200; i++) send.dispatchEvent(new Event('pointerup', { bubbles: true }));
    const { copySendDiagnostic } = await import('./send-diagnostic');
    expect(writeText).not.toHaveBeenCalled();
    expect(await copySendDiagnostic()).toBe('copied');
    const copied = String(writeText.mock.calls[0]![0]);
    expect(JSON.parse(copied).events).toHaveLength(128);
    expect(copied).not.toMatch(/PRIVATE|payload|health|photo|token/);
    expect(readText).not.toHaveBeenCalled();
    dispose();
    vi.unstubAllGlobals();
  });
  it('reports unavailable and rejected clipboard safely without copying empty traces', async () => {
    const { input, send } = fixture();
    const dispose = observeSendDiagnostic(input, send);
    const { copySendDiagnostic } = await import('./send-diagnostic');
    const writeText = vi.fn().mockRejectedValue(new Error('PRIVATE permission failure'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copySendDiagnostic()).toBe('empty');
    expect(writeText).not.toHaveBeenCalled();
    send.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(await copySendDiagnostic()).toBe('failed');
    vi.stubGlobal('navigator', {});
    expect(await copySendDiagnostic()).toBe('unavailable');
    dispose();
    vi.unstubAllGlobals();
  });
});


it('classifies composer controls and containment paths without copying their labels', () => {
  const { input, send, form } = fixture();
  form.className = 'conversation-input';
  const plus = document.createElement('button');
  plus.className = 'composer-more';
  plus.textContent = 'PRIVATE label';
  form.append(plus);
  const dispose = observeSendDiagnostic(input, send);
  plus.dispatchEvent(new Event('pointerup', { bubbles: true, composed: true }));
  const last = readSendDiagnostic().at(-1)!;
  expect(last.target).toBe('plus');
  expect(last.inComposer).toBe(true);
  expect(last.pathInComposer).toBe(true);
  expect(JSON.stringify(last)).not.toContain('PRIVATE');
  dispose();
});

it('retains only captured target categories when native event targets clear after dispatch', async () => {
  const { input, send, form } = fixture();
  form.className = 'conversation-input';
  const dispose = observeSendDiagnostic(input, send);
  const event = new Event('pointerdown', { bubbles: true, cancelable: true });
  send.addEventListener('pointerdown', event => event.preventDefault());
  send.dispatchEvent(event);
  Object.defineProperty(event, 'target', { value: null });
  await vi.waitFor(() => expect(readSendDiagnostic().some(row => row.event === 'pointerdown' && row.phase === 'settled' &&
    row.target === 'send' && row.inComposer && row.pathInComposer && row.prevented)).toBe(true));
  dispose();
});
