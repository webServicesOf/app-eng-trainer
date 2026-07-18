// Phase 3: 잠금화면 미디어키 (Android) — MediaSession + 무음 앵커
// Web Audio(AudioBufferSourceNode)는 Android 잠금화면 미디어 알림을 못 띄움.
// 무음 HTMLAudioElement를 재생해 미디어 세션을 점유, 실제 소리는 Web Audio가 담당.
// ponytail: 무음(전부 0 샘플) 앵커가 Android에서 알림을 실제로 띄우는지는 기기 실측 필요.
//           안 뜨면 → 극저볼륨 tone 삽입, 또는 실제 mp3 element를 앵커로 교체.

// 0.2s 8kHz mono 16bit 무음 WAV를 런타임 생성(샘플 전부 0). loop로 세션 유지.
// 하드코딩 base64보다 안전 — 길이/boundary 오류로 디코딩 실패할 여지 없음.
function makeSilentWavUrl(): string {
  const sr = 8000, dataLen = Math.floor(sr * 0.2) * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, dataLen, true);
  // 샘플 기본값 0 = 무음
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

let anchor: HTMLAudioElement | null = null;

function getAnchor(): HTMLAudioElement {
  if (!anchor) {
    anchor = new Audio(makeSilentWavUrl());
    anchor.loop = true;
    // ponytail: volume 미설정(기본 1). 0으로 두면 Chrome이 inaudible로 판단해
    //           알림을 안 띄울 수 있음. 샘플이 전부 0이라 귀엔 무음.
  }
  return anchor;
}

export interface MediaSessionHandlers {
  prev: () => void;       // previoustrack → 처음부터/이전(더블탭)
  next: () => void;       // nexttrack → 다음 문장
  togglePlay: () => void; // play/pause → 재생정지 토글
  save: () => void;       // stop → 현재 문장 저장
}

const ACTIONS: MediaSessionAction[] = ['previoustrack', 'nexttrack', 'play', 'pause', 'stop'];

/** 미디어 세션 활성화 + action 핸들러 등록. 재생 시작(사용자 제스처 컨텍스트)에서 호출. */
export function startMediaSession(title: string, h: MediaSessionHandlers): void {
  if (!('mediaSession' in navigator)) return;
  getAnchor().play().catch(() => {}); // 제스처 없으면 reject — 무시(다음 재생 때 재시도)
  const ms = navigator.mediaSession;
  ms.metadata = new MediaMetadata({ title, artist: 'eng-trainer' });
  ms.setActionHandler('previoustrack', () => h.prev());
  ms.setActionHandler('nexttrack', () => h.next());
  ms.setActionHandler('play', () => h.togglePlay());
  ms.setActionHandler('pause', () => h.togglePlay());
  ms.setActionHandler('stop', () => h.save());
}

/** OS 위젯 play/pause 버튼 표시 동기화. */
export function setMediaPlaybackState(playing: boolean): void {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
}

/** 화면 이탈 시 핸들러 해제 + 앵커 정지. */
export function stopMediaSession(): void {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  ACTIONS.forEach(a => ms.setActionHandler(a, null));
  ms.playbackState = 'none';
  anchor?.pause();
}
