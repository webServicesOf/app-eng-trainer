import React from 'react';

/**
 * 학습 화면 UI 조작 상태 전역 저장 (localStorage, 기기 로컬).
 * 마지막 사용 상태 = 다음 진입 기본값.
 * ponytail: 기기 간 동기화 필요해지면 Drive sys/settings.json으로 승격.
 */
export function readUiPref<T>(key: string, def: T): T {
  try {
    const s = localStorage.getItem(`ui:${key}`);
    return s != null ? (JSON.parse(s) as T) : def;
  } catch {
    return def;
  }
}

export function writeUiPref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`ui:${key}`, JSON.stringify(value));
  } catch {
    /* private mode/quota — 저장 실패해도 동작엔 지장 없음 */
  }
}

/** useState + localStorage 영속화. setter 시그니처 동일 (함수형 업데이트 지원). */
export function usePersistedState<T>(key: string, def: T) {
  const [value, setValue] = React.useState<T>(() => readUiPref(key, def));
  const set = React.useCallback((action: React.SetStateAction<T>) => {
    setValue(prev => {
      const next = typeof action === 'function' ? (action as (p: T) => T)(prev) : action;
      writeUiPref(key, next);
      return next;
    });
  }, [key]);
  return [value, set] as const;
}
