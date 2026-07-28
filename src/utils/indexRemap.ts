import { SubDeckReview } from '../types';

// 구조 편집(삽입/삭제/분할/병합) 한 번이 문장 번호 공간을 어떻게 이동시키는지 기술.
// pos는 편집 시점의 0-based 배열 위치.
export type StructuralOp =
  | { type: 'insert'; pos: number } // 새 문장이 pos에 삽입됨
  | { type: 'delete'; pos: number } // pos 문장이 삭제됨
  | { type: 'split'; pos: number } // pos 문장이 pos, pos+1로 나뉨
  | { type: 'merge'; pos: number }; // pos, pos+1 문장이 pos로 합쳐짐

// 1-based 문장 index 참조 (savedSentenceIndices, lastIndex). null = 대상 소멸.
export function mapSentenceRef(op: StructuralOp, idx: number): number | null {
  const p = idx - 1;
  switch (op.type) {
    case 'insert':
      return p >= op.pos ? idx + 1 : idx;
    case 'delete':
      return p === op.pos ? null : p > op.pos ? idx - 1 : idx;
    case 'split':
      // 분할 대상 참조는 앞쪽 절반 유지
      return p > op.pos ? idx + 1 : idx;
    case 'merge':
      // 뒤쪽 절반 참조는 병합 문장으로 수렴
      return p > op.pos ? idx - 1 : idx;
  }
}

// 0-based 분할 마커 (marker i = i번 문장 뒤 경계). null = 경계 소멸.
export function mapSplitMarker(op: StructuralOp, i: number): number | null {
  switch (op.type) {
    case 'insert':
      return i >= op.pos ? i + 1 : i;
    case 'delete':
      return i === op.pos ? null : i > op.pos ? i - 1 : i;
    case 'split':
      // 경계는 분할된 두 문장 전체 뒤로
      return i >= op.pos ? i + 1 : i;
    case 'merge':
      // 병합 쌍 내부 경계는 소멸
      return i === op.pos ? null : i > op.pos ? i - 1 : i;
  }
}

// 0-based [start, end) 구간 (subDeckReviews). null = 빈 구간.
export function mapRange(
  op: StructuralOp,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let s = start;
  let e = end;
  switch (op.type) {
    case 'insert':
      if (s >= op.pos) s += 1;
      if (e > op.pos) e += 1;
      break;
    case 'delete':
      if (s > op.pos) s -= 1;
      if (e > op.pos) e -= 1;
      break;
    case 'split':
      if (s > op.pos) s += 1;
      if (e > op.pos) e += 1;
      break;
    case 'merge':
      if (s > op.pos) s -= 1;
      if (e > op.pos + 1) e -= 1;
      break;
  }
  return s < e ? { start: s, end: e } : null;
}

export function remapMarkerSet(markers: Set<number>, op: StructuralOp): Set<number> {
  const next = new Set<number>();
  markers.forEach((m) => {
    const v = mapSplitMarker(op, m);
    if (v != null) next.add(v);
  });
  return next;
}

export function remapSentenceRefList(
  indices: number[] | undefined,
  op: StructuralOp,
): number[] | undefined {
  if (!indices) return indices;
  const mapped = indices
    .map((i) => mapSentenceRef(op, i))
    .filter((v): v is number => v != null);
  return Array.from(new Set(mapped)).sort((a, b) => a - b);
}

export function remapSubDeckReviews(
  reviews: SubDeckReview[] | undefined,
  op: StructuralOp,
): SubDeckReview[] | undefined {
  if (!reviews) return reviews;
  const out: SubDeckReview[] = [];
  for (const r of reviews) {
    const m = mapRange(op, r.startIndex, r.endIndex);
    if (m) out.push({ ...r, startIndex: m.start, endIndex: m.end });
  }
  return out;
}
