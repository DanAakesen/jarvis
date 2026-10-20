import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  draftText,
  loadNutritionTargets,
  NutritionTargetsError,
  nutritionTargetChanges,
  nutritionTargetsFailureMessage,
  parseNutritionDraft,
  parseNutritionTargets,
  saveNutritionTargets,
  type NutritionDraft,
  type NutritionTargetKey,
} from './nutrition-targets';

const bounds = {
  restingKcal: { label: 'Resting energy burn', unit: 'kcal', min: 1000, max: 4000 },
  deficitKcal: { label: 'Per-day deficit', unit: 'kcal', min: 0, max: 2000 },
  proteinGrams: { label: 'Protein target', unit: 'g', min: 30, max: 400 },
};
const synthetic = { restingKcal: 1750, deficitKcal: 350, proteinGrams: 110 };

function reply(overrides: Record<string, unknown> = {}) {
  return { targets: synthetic, missing: [], updatedAt: '2026-10-17T12:00:00.000Z', bounds, ...overrides };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const getAccessToken = vi.fn(async () => ['access', 'fixture'].join('.'));
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  getAccessToken.mockReset().mockResolvedValue(['access', 'fixture'].join('.'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('parseNutritionTargets', () => {
  it('reads a complete reply and works out which targets are missing itself', () => {
    const state = parseNutritionTargets(reply({ targets: { ...synthetic, deficitKcal: null }, missing: [] }));
    expect(state).toMatchObject({
      targets: { restingKcal: 1750, deficitKcal: null, proteinGrams: 110 },
      missing: ['deficitKcal'],
      updatedAt: '2026-10-17T12:00:00.000Z',
    });
    expect(state?.bounds.proteinGrams).toEqual(bounds.proteinGrams);
  });

  it('reads an empty store as three missing targets in field order', () => {
    const state = parseNutritionTargets(reply({
      targets: { restingKcal: null, deficitKcal: null, proteinGrams: null },
      updatedAt: null,
    }));
    expect(state?.missing).toEqual(['restingKcal', 'deficitKcal', 'proteinGrams']);
    expect(state?.updatedAt).toBeNull();
  });

  it.each<[string, unknown]>([
    ['not an object', 'text'],
    ['an array', []],
    ['no targets', reply({ targets: undefined })],
    ['no bounds', reply({ bounds: undefined })],
    ['a missing target key', reply({ targets: { restingKcal: 1750, deficitKcal: 350 } })],
    ['a fractional target', reply({ targets: { ...synthetic, restingKcal: 1750.5 } })],
    ['a numeric string target', reply({ targets: { ...synthetic, restingKcal: '1750' } })],
    ['a target under its minimum', reply({ targets: { ...synthetic, restingKcal: 999 } })],
    ['a target over its maximum', reply({ targets: { ...synthetic, proteinGrams: 401 } })],
    ['an unsafe integer target', reply({ targets: { ...synthetic, restingKcal: 2 ** 60 } })],
    ['a missing bound', reply({ bounds: { restingKcal: bounds.restingKcal, deficitKcal: bounds.deficitKcal } })],
    ['an empty label', reply({ bounds: { ...bounds, restingKcal: { ...bounds.restingKcal, label: ' ' } } })],
    ['an oversized label', reply({ bounds: { ...bounds, restingKcal: { ...bounds.restingKcal, label: 'x'.repeat(81) } } })],
    ['an empty unit', reply({ bounds: { ...bounds, proteinGrams: { ...bounds.proteinGrams, unit: '' } } })],
    ['a minimum above its maximum', reply({ bounds: { ...bounds, proteinGrams: { ...bounds.proteinGrams, min: 450, max: 30 } } })],
    ['a negative minimum', reply({ bounds: { ...bounds, deficitKcal: { ...bounds.deficitKcal, min: -1 } } })],
    ['a fractional maximum', reply({ bounds: { ...bounds, deficitKcal: { ...bounds.deficitKcal, max: 20.5 } } })],
    ['an unparseable save time', reply({ updatedAt: 'yesterday' })],
    ['a numeric save time', reply({ updatedAt: 1_760_000_000 })],
  ])('rejects a reply with %s', (_name, value) => {
    expect(parseNutritionTargets(value)).toBeNull();
  });
});

describe('parseNutritionDraft', () => {
  const resting = bounds.restingKcal;
  const deficit = bounds.deficitKcal;

  it('treats an empty or blank field as a request to clear the target', () => {
    expect(parseNutritionDraft('', resting)).toEqual({ ok: true, value: null });
    expect(parseNutritionDraft('   ', resting)).toEqual({ ok: true, value: null });
  });

  it('accepts whole numbers inside the range, including both ends and a zero minimum', () => {
    expect(parseNutritionDraft('1750', resting)).toEqual({ ok: true, value: 1750 });
    expect(parseNutritionDraft(' 350 ', deficit)).toEqual({ ok: true, value: 350 });
    expect(parseNutritionDraft('1000', resting)).toEqual({ ok: true, value: 1000 });
    expect(parseNutritionDraft('4000', resting)).toEqual({ ok: true, value: 4000 });
    expect(parseNutritionDraft('0', deficit)).toEqual({ ok: true, value: 0 });
  });

  it.each(['999', '4001', '0', '12.5', '-5', '+5', '1e3', '0x7d0', '1,750', '1 750', '1750 kcal', 'abc', '１７５０', '1234567'])(
    'rejects %j for the resting burn',
    (text) => {
      const result = parseNutritionDraft(text, resting);
      expect(result.ok).toBe(false);
    },
  );

  it('explains the rule from the server bounds without echoing the input', () => {
    const result = parseNutritionDraft('secret-ish', resting);
    expect(result).toEqual({
      ok: false,
      message: 'Resting energy burn: enter a whole number from 1000 to 4000 kcal, or leave it empty.',
    });
    expect(JSON.stringify(result)).not.toContain('secret-ish');
  });

  it('shows a stored zero as text rather than as an empty field', () => {
    expect(draftText(0)).toBe('0');
    expect(draftText(1750)).toBe('1750');
    expect(draftText(null)).toBe('');
  });
});

describe('nutritionTargetChanges', () => {
  const saved = synthetic;
  const keys: NutritionTargetKey[] = ['restingKcal', 'deficitKcal', 'proteinGrams'];
  function drafts(overrides: Partial<Record<NutritionTargetKey, NutritionDraft>> = {}) {
    const base = Object.fromEntries(keys.map((key) => [key, { ok: true, value: saved[key] } satisfies NutritionDraft]));
    return { ...base, ...overrides } as Record<NutritionTargetKey, NutritionDraft>;
  }

  it('returns null when nothing changed', () => {
    expect(nutritionTargetChanges(saved, drafts())).toBeNull();
  });

  it('names only the targets that differ, with null for a cleared one', () => {
    expect(nutritionTargetChanges(saved, drafts({
      deficitKcal: { ok: true, value: 380 },
      proteinGrams: { ok: true, value: null },
    }))).toEqual({ deficitKcal: 380, proteinGrams: null });
  });

  it('sets a target that was empty and skips drafts that are not valid', () => {
    expect(nutritionTargetChanges({ ...saved, restingKcal: null }, drafts({
      restingKcal: { ok: true, value: 1800 },
      proteinGrams: { ok: false, message: 'nope' },
    }))).toEqual({ restingKcal: 1800 });
  });
});

describe('nutritionTargetsFailureMessage', () => {
  it('uses page-owned copy that states the action and never carries a figure', () => {
    const kinds = ['unavailable', 'denied', 'rejected', 'invalid', 'failed'] as const;
    for (const kind of kinds) {
      for (const action of ['load', 'save'] as const) {
        const message = nutritionTargetsFailureMessage(kind, action);
        expect(message.length).toBeGreaterThan(10);
        expect(message).not.toMatch(/\d/u);
      }
    }
    expect(nutritionTargetsFailureMessage('failed', 'save')).toMatch(/entries are kept/u);
    expect(nutritionTargetsFailureMessage('invalid', 'save')).toMatch(/Reload Settings/u);
    expect(nutritionTargetsFailureMessage('denied', 'save')).toMatch(/change/u);
    expect(nutritionTargetsFailureMessage('denied', 'load')).toMatch(/read/u);
  });
});

describe('requests', () => {
  const signal = () => new AbortController().signal;

  it('reads the targets with the signed-in token, no caching and the server bounds', async () => {
    fetchMock.mockResolvedValueOnce(json(reply()));
    const state = await loadNutritionTargets('https://api.example.com/', getAccessToken, signal());
    expect(state.targets).toEqual(synthetic);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/daily/nutrition-targets');
    expect(init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      headers: { Authorization: `${['Bear', 'er'].join('')} ${['access', 'fixture'].join('.')}`, Accept: 'application/json' },
    });
    expect(init).not.toHaveProperty('body');
  });

  it('sends only the changes as a JSON PATCH and returns the committed readback', async () => {
    fetchMock.mockResolvedValueOnce(json(reply({ targets: { ...synthetic, deficitKcal: 380 } })));
    const state = await saveNutritionTargets('https://api.example.com', getAccessToken, { deficitKcal: 380 }, signal());
    expect(state.targets.deficitKcal).toBe(380);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/daily/nutrition-targets');
    expect(init).toMatchObject({
      method: 'PATCH',
      cache: 'no-store',
      body: '{"deficitKcal":380}',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it.each([
    [404, 'unavailable'],
    [405, 'unavailable'],
    [501, 'unavailable'],
    [401, 'denied'],
    [403, 'denied'],
    [400, 'failed'],
    [502, 'failed'],
    [503, 'failed'],
  ])('maps a %i on read to %s', async (status, kind) => {
    fetchMock.mockResolvedValueOnce(json({ error: 'text that must never be shown' }, status));
    await expect(loadNutritionTargets('https://api.example.com', getAccessToken, signal()))
      .rejects.toMatchObject({ name: 'NutritionTargetsError', kind });
  });

  it('maps a 400 on save to rejected and keeps the other statuses as on read', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'x' }, 400)).mockResolvedValueOnce(json({ error: 'x' }, 503));
    await expect(saveNutritionTargets('https://api.example.com', getAccessToken, { restingKcal: 1800 }, signal()))
      .rejects.toMatchObject({ kind: 'rejected' });
    await expect(saveNutritionTargets('https://api.example.com', getAccessToken, { restingKcal: 1800 }, signal()))
      .rejects.toMatchObject({ kind: 'failed' });
  });

  it('reports a network failure, an unreadable body and an off-contract reply as distinct failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('<html>', { status: 200 }))
      .mockResolvedValueOnce(json({ targets: {} }));
    const kinds: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      kinds.push(await loadNutritionTargets('https://api.example.com', getAccessToken, signal())
        .then(() => 'ok', (error: unknown) => (error instanceof NutritionTargetsError ? error.kind : 'other')));
    }
    expect(kinds).toEqual(['failed', 'invalid', 'invalid']);
  });

  it('asks for nothing when there is no backend or no token', async () => {
    await expect(loadNutritionTargets(null, getAccessToken, signal())).rejects.toMatchObject({ kind: 'unavailable' });
    expect(getAccessToken).not.toHaveBeenCalled();
    getAccessToken.mockRejectedValueOnce(new Error('expired'));
    await expect(loadNutritionTargets('https://api.example.com', getAccessToken, signal())).rejects.toMatchObject({ kind: 'denied' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes an abort through instead of reporting it as a failure', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadNutritionTargets('https://api.example.com', getAccessToken, controller.signal))
      .rejects.not.toBeInstanceOf(NutritionTargetsError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
