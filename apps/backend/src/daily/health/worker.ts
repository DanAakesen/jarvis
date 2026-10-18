import type { ProcessingResult } from './processor.js';

type HealthProcessor = { processNext(signal: AbortSignal): Promise<ProcessingResult> };

export class HealthProcessingWorker {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private batch = 0;
  private wakeRequested = false;

  constructor(private readonly processor: HealthProcessor, private readonly onResult: (state: ProcessingResult['state']) => void = () => {}) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  wake(): void {
    if (this.stopped) return;
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  private schedule(delay: number): void {
    if (this.stopped || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.process();
    }, delay);
  }

  private async process(): Promise<void> {
    if (this.stopped) return;
    let delay = 30_000;
    try {
      const result = await this.processor.processNext(this.controller.signal);
      this.onResult(result.state);
      if (result.state === 'processed' || result.state === 'quarantined') {
        this.batch++;
        if (this.batch < 10) delay = 0;
        else { this.batch = 0; delay = 1000; }
      } else {
        this.batch = 0;
      }
    } catch {
      this.batch = 0;
    }
    if (this.stopped) return;
    if (this.wakeRequested) delay = 0;
    this.wakeRequested = false;
    this.running = undefined;
    this.schedule(delay);
  }
}
