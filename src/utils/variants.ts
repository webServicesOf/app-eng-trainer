import { VariantKey, TranscriptVariant, TranscriptVariants } from '../types';

// top-level 미러 ↔ variants[activeVariant] 사이를 오가는 필드들 (전부 sentence-index 종속).
const PER_VARIANT_KEYS = [
  'sentences',
  'splitPoints',
  'subDeckReviews',
  'savedAsDeck',
  'savedSentenceIndices',
  'savedSentenceReview',
  'lastIndex',
] as const;

// variants 번들 + 활성 포인터 + 미러 필드를 가진 아티클 형태
type VariantCarrier = TranscriptVariant & {
  variants?: TranscriptVariants;
  activeVariant?: VariantKey;
};

export function hasVariants(a: { variants?: TranscriptVariants }): boolean {
  return !!(a.variants && (a.variants.vtt || a.variants.whisperx));
}

// top-level 미러에서 현재 활성 variant 상태 추출
export function extractActive<T extends VariantCarrier>(a: T): TranscriptVariant {
  const v: any = {};
  for (const k of PER_VARIANT_KEYS) v[k] = (a as any)[k];
  return v as TranscriptVariant;
}

// 활성 variant 슬롯에 top-level 미러를 되쓰기 (immutable). variants 없으면 그대로.
export function foldActive<T extends VariantCarrier>(a: T): T {
  if (!a.variants || !a.activeVariant) return a;
  return { ...a, variants: { ...a.variants, [a.activeVariant]: extractActive(a) } };
}

// variants[key]를 top-level 미러로 끌어올리고 activeVariant 설정 (immutable).
export function applyVariant<T extends VariantCarrier>(a: T, key: VariantKey): T {
  const slot: TranscriptVariant = a.variants?.[key] ?? { sentences: [] };
  const next: any = { ...a, activeVariant: key };
  for (const k of PER_VARIANT_KEYS) next[k] = (slot as any)[k];
  return next as T;
}
