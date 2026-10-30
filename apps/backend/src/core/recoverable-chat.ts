import { Readable } from 'node:stream';

/** One execution, multiple disposable transports. Completed replies also live in SQL history. */
export class RecoverableChat {
  readonly controller = new AbortController();
  private readonly frames: string[] = [];
  private readonly listeners = new Set<() => void>();
  private ended = false;
  private bytes = 0;

  constructor(readonly sessionId: string, readonly messageId: string, readonly language: 'da' | 'en') {}

  get finished(): boolean { return this.ended; }

  async run(source: AsyncIterable<string>): Promise<void> {
    try {
      for await (const frame of source) {
        this.bytes += Buffer.byteLength(frame);
        if (this.bytes > 1024 * 1024) {
          this.controller.abort();
          this.frames.push('event: error\ndata: {"error":"Reply exceeded the recovery limit. Check conversation and action status before trying again."}\n\n');
          break;
        }
        this.frames.push(frame);
        for (const wake of this.listeners) wake();
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
    const flush = () => {
      while (!stream.destroyed && cursor < this.frames.length) {
        if (!stream.push(this.frames[cursor++]!)) return;
      }
      if (this.ended && !stream.destroyed) stream.push(null);
    };
    stream._read = flush;
    this.listeners.add(flush);
    stream.once('close', () => this.listeners.delete(flush));
    flush();
    return stream;
  }
}
