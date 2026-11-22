import { Readable } from 'node:stream';
import { failureCopy } from '@jarvis/contracts';

const frameName = /^(?:id: [^\n]*\n)?event: ([a-z_]+)\n/u;
const errorFrame = (message: string): string => `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`;

/** One execution, multiple disposable transports. Completed replies also live in SQL history. */
export class RecoverableChat {
  readonly controller = new AbortController();
  private readonly frames: string[] = [];
  private readonly listeners = new Set<() => void>();
  private ended = false;
  private bytes = 0;
  private overflowed = false;
  /** The `done` frame of a saved reply is published: nothing after it may call the turn failed. */
  private delivered = false;

  constructor(readonly sessionId: string, readonly messageId: string) {}

  get finished(): boolean { return this.ended; }

  /** Append source-bound progress to the same ordered replay as the final reply. */
  publish(frame: string): boolean {
    if (this.ended || this.overflowed) return false;
    const name = frameName.exec(frame)?.[1];
    // A saved reply is never reported as failed afterwards: a late error frame is dropped, and the `done` frame itself always fits.
    // The clients read up to 4 MiB of a reply stream (web `maxChatStreamBytes`, iPhone `maximumStreamBytes`), which covers this cap plus `done`.
    if (this.delivered && name === 'error') return true;
    this.bytes += Buffer.byteLength(frame);
    if (this.bytes > 1024 * 1024 && name !== 'done') {
      this.overflowed = true;
      this.controller.abort();
      this.frames.push(errorFrame(failureCopy.reply_too_long.chat));
    } else {
      this.frames.push(frame);
      if (name === 'done') this.delivered = true;
    }
    for (const wake of this.listeners) wake();
    return !this.overflowed;
  }

  async run(source: AsyncIterable<string>): Promise<void> {
    try {
      for await (const frame of source) {
        if (!this.publish(frame)) break;
      }
    } catch (error) {
      if (!this.delivered) this.frames.push(errorFrame(failureCopy.cut_off.chat));
      throw error;
    } finally {
      this.ended = true;
      for (const wake of this.listeners) wake();
    }
  }

  stream(): Readable {
    const stream = new Readable({ read() {} });
    let cursor = 0;
    // Transport liveness is not a tool result and does not consume replay storage.
    const heartbeat = setInterval(() => {
      if (this.ended || stream.destroyed) { clearInterval(heartbeat); return; }
      if (stream.readableLength === 0) stream.push(': keepalive\n\n');
    }, 15_000);
    heartbeat.unref();
    const flush = () => {
      while (!stream.destroyed && cursor < this.frames.length) {
        if (!stream.push(this.frames[cursor++]!)) return;
      }
      if (this.ended && !stream.destroyed) {
        clearInterval(heartbeat);
        stream.push(null);
      }
    };
    stream._read = flush;
    this.listeners.add(flush);
    stream.once('close', () => {
      clearInterval(heartbeat);
      this.listeners.delete(flush);
    });
    flush();
    return stream;
  }
}
