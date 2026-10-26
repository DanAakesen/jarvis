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
    expect(submit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('PRIVATE draft token photo health');
    const trace = readSendDiagnostic();
    expect(trace.some(row => row.event === 'submit' && row.phase === 'settled' && row.prevented)).toBe(true);
    expect(storage).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(trace)).not.toMatch(/PRIVATE|payload|health|photo|token/);
    expect(Object.keys(trace[0]!).sort()).toEqual(['ms', 'event', 'phase', 'target', 'focused', 'prevented', 'disabled', 'pointer', 'viewport', 'button'].sort());
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
