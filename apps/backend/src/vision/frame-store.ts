import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

export interface FrameIdentity {
  readonly ownerObjectId: string;
  readonly sessionId: string;
  readonly turnId?: string;
}

interface StoredFrame extends FrameIdentity {
  readonly image: Buffer;
  readonly expiresAt: number;
  readonly timer: ReturnType<typeof setTimeout>;
  messageId?: string;
}

export class FrameStore {
  private readonly frames = new Map<string, StoredFrame>();
  private closed = false;
  private pending = 0;

  constructor(
    private readonly ttlMs = 60_000,
    private readonly capacity = 128,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 60_000 ||
        !Number.isInteger(capacity) || capacity < 1 || capacity > 128) {
      throw new TypeError('Invalid private frame limits');
    }
  }

  async put(input: FrameIdentity & { readonly image: Buffer; readonly capturedAt?: number }): Promise<string> {
    if (this.closed) throw new Error('Private frame store closed');
    if (this.pending >= 8) throw new Error('Private frame preprocessing busy');
    this.pending++;
    let image: Buffer;
    try {
      image = await sharp(input.image, { limitInputPixels: 40_000_000 })
        .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 }).toBuffer();
    } finally { this.pending--; }
    if (this.closed) {
      image.fill(0);
      throw new Error('Private frame store closed');
    }
    if (image.length > 1_000_000) {
      image.fill(0);
      throw new Error('Private frame exceeded the size limit');
    }
    const expiresAt = Math.min(this.now(), input.capturedAt ?? this.now()) + this.ttlMs;
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      image.fill(0);
      throw new Error('Private frame expired');
    }
    for (const [id, frame] of this.frames) {
      if (frame.expiresAt <= this.now() ||
          (frame.ownerObjectId.toLowerCase() === input.ownerObjectId.toLowerCase() &&
            frame.sessionId === input.sessionId && frame.turnId === input.turnId)) this.remove(id);
    }
    while (this.frames.size >= this.capacity) this.remove(this.frames.keys().next().value!);
    const frameId = randomBytes(24).toString('base64url');
    const timer = setTimeout(() => this.remove(frameId), expiresAt - this.now());
    timer.unref();
    this.frames.set(frameId, { ownerObjectId: input.ownerObjectId, sessionId: input.sessionId,
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      image, expiresAt, timer });
    return frameId;
  }

  bind(frameId: string, identity: FrameIdentity & { readonly messageId: string }): boolean {
    const frame = this.authorized(frameId, identity);
    if (!frame || (frame.messageId !== undefined && frame.messageId !== identity.messageId)) return false;
    frame.messageId = identity.messageId;
    return true;
  }

  consume(frameId: string, identity: FrameIdentity & { readonly messageId: string }): Buffer | undefined {
    const frame = this.authorized(frameId, identity);
    if (!frame || frame.messageId !== identity.messageId) return undefined;
    const image = Buffer.from(frame.image);
    this.remove(frameId);
    return image;
  }

  discard(frameId: string, identity: FrameIdentity): boolean {
    if (!this.authorized(frameId, identity)) return false;
    this.remove(frameId);
    return true;
  }

  forgetSession(sessionId: string): void {
    for (const [id, frame] of this.frames) if (frame.sessionId === sessionId) this.remove(id);
  }

  close(): void {
    this.closed = true;
    for (const id of this.frames.keys()) this.remove(id);
  }

  private authorized(frameId: string, identity: FrameIdentity): StoredFrame | undefined {
    const frame = this.frames.get(frameId);
    if (!frame) return undefined;
    if (frame.expiresAt <= this.now()) {
      this.remove(frameId);
      return undefined;
    }
    return frame.ownerObjectId.toLowerCase() === identity.ownerObjectId.toLowerCase() &&
      frame.sessionId === identity.sessionId && frame.turnId === identity.turnId ? frame : undefined;
  }

  private remove(frameId: string): void {
    const frame = this.frames.get(frameId);
    if (!frame) return;
    clearTimeout(frame.timer);
    frame.image.fill(0);
    this.frames.delete(frameId);
  }
}
