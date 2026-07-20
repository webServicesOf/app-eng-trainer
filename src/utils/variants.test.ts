import { foldActive, applyVariant, hasVariants, extractActive } from './variants';

// variant 간 커플링 0 검증: 편집→전환→편집→복귀 시 각 variant 편집 독립 보존.
type A = {
  id: string;
  sentences: { index: number; text: string }[];
  splitPoints?: number[];
  variants?: any;
  activeVariant?: 'vtt' | 'whisperx';
};

const base = (): A => ({
  id: 'x',
  variants: {
    vtt: { sentences: [{ index: 1, text: 'v1' }, { index: 2, text: 'v2' }] },
    whisperx: { sentences: [{ index: 1, text: 'w1' }] },
  },
  activeVariant: 'vtt',
  sentences: [],
});

test('applyVariant hoists slot to top-level mirror', () => {
  const a = applyVariant(base(), 'vtt');
  expect(a.activeVariant).toBe('vtt');
  expect(a.sentences.map(s => s.text)).toEqual(['v1', 'v2']);
});

test('edit → switch → edit → switch back keeps each variant independent', () => {
  // start on VTT, edit a sentence + add a split
  let a = applyVariant(base(), 'vtt');
  a = { ...a, sentences: [{ index: 1, text: 'v1-EDITED' }, { index: 2, text: 'v2' }], splitPoints: [1] };

  // switch to whisperX (fold VTT edits into its slot, hoist whisperX)
  a = applyVariant(foldActive(a), 'whisperx');
  expect(a.sentences.map(s => s.text)).toEqual(['w1']);
  expect(a.splitPoints).toBeUndefined(); // whisperX has no splits

  // edit whisperX + add its own split
  a = { ...a, sentences: [{ index: 1, text: 'w1-EDITED' }], splitPoints: [0] };

  // switch back to VTT → VTT edits + split intact, whisperX untouched
  a = applyVariant(foldActive(a), 'vtt');
  expect(a.sentences.map(s => s.text)).toEqual(['v1-EDITED', 'v2']);
  expect(a.splitPoints).toEqual([1]);
  expect(a.variants.whisperx.sentences[0].text).toBe('w1-EDITED');
  expect(a.variants.whisperx.splitPoints).toEqual([0]);
});

test('foldActive is a no-op without variants (legacy article)', () => {
  const legacy = { id: 'y', sentences: [{ index: 1, text: 's' }] };
  expect(hasVariants(legacy as any)).toBe(false);
  expect(foldActive(legacy as any)).toBe(legacy);
});

test('extractActive pulls only per-variant fields from the mirror', () => {
  const a = applyVariant(base(), 'vtt');
  const v = extractActive({ ...a, splitPoints: [1] });
  expect(v.sentences.map(s => (s as any).text)).toEqual(['v1', 'v2']);
  expect(v.splitPoints).toEqual([1]);
  expect((v as any).id).toBeUndefined(); // global field not extracted
});
