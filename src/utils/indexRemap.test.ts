import { mapSentenceRef, mapSplitMarker, mapRange, remapSentenceRefList } from './indexRemap';

// 문장 5개, 저장 인덱스(1-based) [2, 4] 기준 시나리오
describe('indexRemap', () => {
  it('insert shifts refs at/after position', () => {
    // 0-based pos 1 (= 2번 문장 자리)에 삽입 → 2는 3으로, 4는 5로
    expect(remapSentenceRefList([2, 4], { type: 'insert', pos: 1 })).toEqual([3, 5]);
    // 끝에 삽입 → 불변
    expect(remapSentenceRefList([2, 4], { type: 'insert', pos: 5 })).toEqual([2, 4]);
  });

  it('delete drops exact ref, shifts later refs', () => {
    expect(remapSentenceRefList([2, 4], { type: 'delete', pos: 1 })).toEqual([3]);
    expect(remapSentenceRefList([2, 4], { type: 'delete', pos: 0 })).toEqual([1, 3]);
  });

  it('split keeps ref on first half, shifts later refs', () => {
    expect(mapSentenceRef({ type: 'split', pos: 1 }, 2)).toBe(2);
    expect(mapSentenceRef({ type: 'split', pos: 1 }, 4)).toBe(5);
  });

  it('merge collapses second-half ref into merged sentence and dedupes', () => {
    // pos 1: 2번+3번 병합. 3번 참조 → 2번
    expect(mapSentenceRef({ type: 'merge', pos: 1 }, 3)).toBe(2);
    expect(remapSentenceRefList([2, 3, 4], { type: 'merge', pos: 1 })).toEqual([2, 3]);
  });

  it('split marker follows whole original content; dies inside merged pair', () => {
    expect(mapSplitMarker({ type: 'split', pos: 2 }, 2)).toBe(3);
    expect(mapSplitMarker({ type: 'merge', pos: 2 }, 2)).toBeNull();
    expect(mapSplitMarker({ type: 'delete', pos: 2 }, 2)).toBeNull();
    expect(mapSplitMarker({ type: 'insert', pos: 2 }, 2)).toBe(3);
  });

  it('range shrinks on inner delete, grows on inner split, drops when empty', () => {
    expect(mapRange({ type: 'delete', pos: 2 }, 2, 4)).toEqual({ start: 2, end: 3 });
    expect(mapRange({ type: 'split', pos: 2 }, 2, 4)).toEqual({ start: 2, end: 5 });
    expect(mapRange({ type: 'delete', pos: 2 }, 2, 3)).toBeNull();
    // 구간 밖 편집은 불변
    expect(mapRange({ type: 'merge', pos: 4 }, 0, 2)).toEqual({ start: 0, end: 2 });
  });
});
