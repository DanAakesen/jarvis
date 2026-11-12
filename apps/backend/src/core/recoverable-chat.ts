import { Readable } from 'node:stream';

/** One execution, multiple disposable transports. Completed replies also live in SQL history. */
export class RecoverableChat {
  readonly controller = new AbortController();
  private readonly frames: string[] = [];
  private readonly listeners = new Set<() => void>();
  private ended = false;
  private bytes = 0;
  private overflowed = false;

  constructor(readonly sessionId: string, readonly messageId: string) {}

  get finished(): boolean { return this.ended; }

  /** Append source-bound progress to the same ordered replay as the final reply. */
  publish(frame: string): boolean {
    if (this.ended || this.overflowed) return false;
    this.bytes += Buffer.byteLength(frame);
    if (this.bytes > 1024 * 1024) {
      this.overflowed = true;
      this.controller.abort();
      this.frames.push('event: error\ndata: {"error":"Reply exceeded the recovery limit. Check conversation and action status before trying again."}\n\n');
    } else {
      this.frames.push(frame);
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
      this.frames.push('event: error\ndata: {"error":"Reply interrupted. Check conversation and action status before trying again."}\n\n');
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
