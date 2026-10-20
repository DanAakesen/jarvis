export interface VisualTurnContext {
  readonly source: 'camera' | 'screen';
  readonly capturedAt: string;
  readonly description?: string;
  readonly question?: string;
  readonly frameId?: string;
  readonly turnId?: string;
}

export interface VisualResult {
  readonly visualPath: 'image' | 'caption';
  readonly visualReason?: string;
}

export function parseVisualResult(value: unknown): VisualResult | undefined {
  if (typeof value !== 'object' || value === null ||
      !('visualPath' in value) && !('visualReason' in value)) return undefined;
  if (!('visualPath' in value) || (value.visualPath !== 'image' && value.visualPath !== 'caption') ||
      'visualReason' in value && (typeof value.visualReason !== 'string' || !/^[a-z0-9_]{1,64}$/u.test(value.visualReason))) {
    throw new Error('Jarvis returned an invalid visual input status.');
  }
  return {
    visualPath: value.visualPath,
    ...('visualReason' in value && typeof value.visualReason === 'string' ? { visualReason: value.visualReason } : {}),
  };
}

export function visualResultText(result: VisualResult): string {
  if (result.visualPath === 'image') return 'Image supplied to Jarvis for this turn.';
  const reason = result.visualReason;
  const detail = reason === 'daily_limit' ? ' The per-day image limit was reached.'
    : reason === 'budget_exhausted' ? ' The image budget was reached.'
    : reason === 'budget_unavailable' ? ' The image budget could not be checked.'
    : reason === 'frame_rate_limited' ? ' Image input was rate-limited.'
      : reason === 'frame_unavailable' || reason === 'frame_missing' ? ' The image reference was unavailable.'
        : reason === 'image_input_unverified' ? ' Model image support has not been verified.'
          : reason === 'legacy_agent' ? ' Direct image input is not enabled.'
          : reason === 'image_rejected' ? ' The model could not accept the image.'
            : reason === 'image_unavailable' ? ' The image could not be supplied.'
            : '';
  return `Caption only - no image supplied to Jarvis for this turn.${detail}`;
}

export function isVisualFrameId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

export function isVisualQuestion(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length <= 500;
}

export function isVisualCapturedAt(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

export function parseVisualTurnContext(value: unknown): VisualTurnContext {
  if (typeof value !== 'object' || value === null ||
      !('source' in value) || (value.source !== 'camera' && value.source !== 'screen') ||
      !('capturedAt' in value) || !isVisualCapturedAt(value.capturedAt)) {
    throw new Error('Visual context needs a source and valid capture time.');
  }
  const description = 'description' in value ? value.description : undefined;
  const question = 'question' in value ? value.question : undefined;
  const frameId = 'frameId' in value ? value.frameId : undefined;
  const turnId = 'turnId' in value ? value.turnId : undefined;
  if (description !== undefined && (typeof description !== 'string' || !description.trim() || description.length > 5_000) ||
      description === undefined && !isVisualFrameId(frameId)) {
    throw new Error('Visual context needs an image reference or a bounded description.');
  }
  if (question !== undefined && !isVisualQuestion(question)) {
    throw new Error('Visual questions can contain at most 500 characters.');
  }
  if (frameId !== undefined && !isVisualFrameId(frameId)) {
    throw new Error('Jarvis returned an invalid image reference.');
  }
  if (turnId !== undefined && !isVisualFrameId(turnId)) {
    throw new Error('Jarvis returned an invalid visual turn reference.');
  }
  return {
    source: value.source,
    capturedAt: value.capturedAt,
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof question === 'string' ? { question: question.trim() } : {}),
    ...(typeof frameId === 'string' ? { frameId } : {}),
    ...(typeof turnId === 'string' ? { turnId } : {}),
  };
}
