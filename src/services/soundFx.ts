// 짧은 WebAudio 알림음 — 오디오 에셋 없이 오실레이터로 합성.
// ponytail: 공유 lazy AudioContext 1개. 실패(정책 차단 등)는 조용히 무시(best-effort).

let ctx: AudioContext | null = null;

function ac(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

type Note = { f: number; t: number; d: number }; // freq(Hz), 시작오프셋(s), 길이(s)

// notes를 순차 스케줄. 클릭 노이즈 방지용 짧은 attack/release 엔벨로프.
// 반환: 마지막 음이 끝날 때 resolve되는 Promise (진입음→첫문장 순차 재생용).
function playNotes(notes: Note[], type: OscillatorType, gain: number): Promise<void> {
  let c: AudioContext;
  try { c = ac(); } catch { return Promise.resolve(); }
  const t0 = c.currentTime;
  let end = 0;
  for (const n of notes) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = n.f;
    g.gain.setValueAtTime(0, t0 + n.t);
    g.gain.linearRampToValueAtTime(gain, t0 + n.t + 0.012);
    g.gain.linearRampToValueAtTime(0, t0 + n.t + n.d);
    osc.connect(g).connect(c.destination);
    osc.start(t0 + n.t);
    osc.stop(t0 + n.t + n.d + 0.02);
    end = Math.max(end, n.t + n.d);
  }
  return new Promise((res) => setTimeout(res, end * 1000 + 30));
}

// 켜짐(누적): 경쾌한 상승 2음 — "띠롱~"
export const playToggleOn = () =>
  playNotes([{ f: 784, t: 0, d: 0.09 }, { f: 1047, t: 0.085, d: 0.14 }], 'triangle', 0.16);

// 꺼짐(단일): 차분한 하강 2음 — "뜨른"
export const playToggleOff = () =>
  playNotes([{ f: 523, t: 0, d: 0.1 }, { f: 349, t: 0.095, d: 0.17 }], 'sine', 0.14);

// 플레이리스트 다음 영상 진입: 부드러운 상승 3음 알림
export const playEnter = () =>
  playNotes(
    [{ f: 523, t: 0, d: 0.1 }, { f: 659, t: 0.1, d: 0.1 }, { f: 880, t: 0.2, d: 0.18 }],
    'triangle',
    0.15,
  );
