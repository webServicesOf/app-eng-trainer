import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Paper, Stack, IconButton, Typography, Tooltip } from '@mui/material';
import { FiberManualRecord, Stop, GraphicEq, PlayArrow } from '@mui/icons-material';

interface Props {
  /** Full decoded article buffer (from audioSeekService.getBuffer()). null until MP3 loaded. */
  audioBuffer: AudioBuffer | null;
  /** Currently exposed sentence range (single: 1 sentence, cumulative: window). Absolute seconds. */
  rangeStart: number;
  rangeEnd: number;
  /** Current playback rate — reference plays at this, so recording cap = refDur / rate. */
  rate: number;
  /** Play the reference from start via the parent (handles YouTube video / MP3 + rate). */
  onPlayOriginal: () => void;
  /** Stop the parent's reference playback (used when interrupting to record/replay). */
  onStopOriginal: () => void;
  /** Current reference playback position in article seconds, or null when not playing. */
  getPlayPosition: () => number | null;
}

interface Peak { t: number; v: number }
type Phase = 'idle' | 'rec' | 'play' | 'refplay';

const REF_COLOR = '#78909c';
const YOU_COLOR = '#1976d2';
const CURSOR = '#f44336';
const CANVAS_H = 52;

/** Bucketed max-abs peaks over [startSec,endSec] of a mono channel; t is 0-based within the slice. */
export function bufferPeaks(buf: AudioBuffer, startSec: number, endSec: number, buckets: number): Peak[] {
  const ch = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const s = Math.max(0, Math.floor(startSec * sr));
  const e = Math.min(ch.length, Math.floor(endSec * sr));
  const len = e - s;
  if (len <= 0 || buckets <= 0) return [];
  const dur = (e - s) / sr;
  const step = len / buckets;
  const peaks: Peak[] = [];
  for (let i = 0; i < buckets; i++) {
    const a = s + Math.floor(i * step);
    const b = s + Math.floor((i + 1) * step);
    let m = 0;
    for (let j = a; j < b; j++) { const av = Math.abs(ch[j]); if (av > m) m = av; }
    peaks.push({ t: (i / buckets) * dur, v: m });
  }
  return peaks;
}

/** Draw peaks mapped over [0,axisDur] across `width` CSS px, plus optional red cursor. */
function drawWave(
  canvas: HTMLCanvasElement | null,
  peaks: Peak[],
  axisDur: number,
  color: string,
  cursorSec: number,
  width: number,
) {
  if (!canvas || width <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const h = CANVAS_H;
  const bw = Math.round(width * dpr);
  const bh = Math.round(h * dpr);
  // Only reallocate the backing store when size actually changes (per-frame realloc = jank).
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, h);
  const mid = h / 2;
  if (axisDur > 0) {
    ctx.fillStyle = color;
    for (const p of peaks) {
      const x = (p.t / axisDur) * width;
      if (x < 0 || x > width) continue; // out of shared axis → clipped, never overflows
      const ph = Math.max(1, p.v * h * 0.92);
      ctx.fillRect(x, mid - ph / 2, 2, ph);
    }
    if (cursorSec >= 0) {
      const cx = Math.min(width, (cursorSec / axisDur) * width);
      ctx.fillStyle = CURSOR;
      ctx.fillRect(cx - 1, 0, 2, h);
    }
  }
}

export default function RecordCompare({ audioBuffer, rangeStart, rangeEnd, rate, onPlayOriginal, onStopOriginal, getPlayPosition }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [hasRec, setHasRec] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const refCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const youCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const recStartRef = useRef<number>(0);

  const refPeaksRef = useRef<Peak[]>([]);
  const youPeaksRef = useRef<Peak[]>([]);
  const recDurRef = useRef<number>(0);
  const blobUrlRef = useRef<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Reference segment duration + recording cap. Reference plays at `rate`, so its wall-clock
  // length (= how long the learner shadows) is refDur / rate. Recording never exceeds that.
  const refDur = rangeEnd > rangeStart ? rangeEnd - rangeStart : 3;
  const maxDur = refDur / (rate > 0 ? rate : 1);

  const getCtx = () => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new AudioContext();
    return ctxRef.current;
  };

  /**
   * Acquire (or reuse) a warm mic stream + analyser. Diagnosed cold-start: a fresh getUserMedia
   * graph delivers exactly-zero samples for ~0.6s before the first buffer flows — which showed up
   * as a frozen-looking flat waveform + a silent recording head. Pre-warming on panel open moves
   * that latency off the record path; the stream is kept alive across takes.
   */
  const ensureStream = useCallback(async () => {
    const cur = streamRef.current;
    if (cur && cur.getAudioTracks()[0]?.readyState === 'live' && analyserRef.current) return cur;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    streamRef.current = stream;
    const ctx = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser); // NOT to destination — avoid mic feedback
    analyserRef.current = analyser;
    return stream;
  }, []);

  // Pre-warm the mic when the panel opens (best-effort; falls back to on-demand in startRecording).
  useEffect(() => { ensureStream().catch(() => {}); }, [ensureStream]);

  const widthRef = useRef(0);
  useEffect(() => { widthRef.current = width; }, [width]);

  // REFERENCE always fills full width (its own duration). YOU fills width over its target
  // window (maxDur) so "finishing at the right edge" == matched the reference pace.
  const render = useCallback((youPeaks: Peak[], youAxis: number, youCursor: number, refCursor = -1) => {
    const w = widthRef.current;
    drawWave(refCanvasRef.current, refPeaksRef.current, refDur, REF_COLOR, refCursor, w);
    drawWave(youCanvasRef.current, youPeaks, youAxis, YOU_COLOR, youCursor, w);
  }, [refDur]);

  // Measure container width (shared by both canvases) — on mount + window resize.
  useEffect(() => {
    const measure = () => setWidth(wrapRef.current?.clientWidth || 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Recompute reference peaks + reset recording whenever range/buffer/width changes.
  useEffect(() => {
    const buckets = Math.max(40, Math.floor(width / 2));
    refPeaksRef.current = audioBuffer ? bufferPeaks(audioBuffer, rangeStart, rangeEnd, buckets) : [];
    // ephemeral: leaving the range drops the recording
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    youPeaksRef.current = [];
    recDurRef.current = 0;
    setHasRec(false);
    setPhase('idle');
    render([], maxDur, -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer, rangeStart, rangeEnd, width]);

  const stopPlayback = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    audioElRef.current?.pause();
  }, []);

  const refPlayingRef = useRef(false);
  const stopRefPlay = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (refPlayingRef.current) { refPlayingRef.current = false; onStopOriginal(); }
  }, [onStopOriginal]);

  // r = play the reference via the parent (YouTube video / MP3 at rate). The parent owns the audio;
  // here we only poll its playback position and sweep a red cursor across the REFERENCE waveform.
  // MP3 waveform and YT audio share the same source/time axis, so the cursor stays consistent.
  const playReference = useCallback(() => {
    if (phase === 'rec' || widthRef.current <= 0) return;
    stopPlayback();
    stopRefPlay();
    onPlayOriginal();
    refPlayingRef.current = true;
    setPhase('refplay');
    const r = rate > 0 ? rate : 1;
    const startWall = performance.now();
    const scan = () => {
      if (!refPlayingRef.current) return;
      const abs = getPlayPosition();
      const seg = abs == null ? -1 : abs - rangeStart;
      if (seg >= 0 && seg < refDur) render(youPeaksRef.current, maxDur, -1, seg);
      const wallMs = performance.now() - startWall;
      const ended = seg >= refDur || wallMs > (refDur / r) * 1000 + 600; // natural end or safety timeout
      if (ended) {
        refPlayingRef.current = false;
        render(youPeaksRef.current, maxDur, -1, -1);
        setPhase('idle');
      } else {
        rafRef.current = requestAnimationFrame(scan);
      }
    };
    rafRef.current = requestAnimationFrame(scan);
  }, [phase, rate, rangeStart, refDur, maxDur, render, stopPlayback, stopRefPlay, onPlayOriginal, getPlayPosition]);

  const startPlayback = useCallback(() => {
    if (!blobUrlRef.current) return;
    let el = audioElRef.current;
    if (!el) { el = new Audio(); audioElRef.current = el; }
    el.src = blobUrlRef.current;
    el.currentTime = 0;
    const axis = maxDur; // same target window as recording → cursor lands where the take ended
    setPhase('play');
    const scan = () => {
      render(youPeaksRef.current, axis, el!.currentTime);
      if (!el!.paused && !el!.ended) rafRef.current = requestAnimationFrame(scan);
    };
    el.onended = () => { render(youPeaksRef.current, axis, recDurRef.current); setPhase('idle'); };
    el.play().then(() => { rafRef.current = requestAnimationFrame(scan); }).catch(() => setPhase('idle'));
  }, [maxDur, render]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await ensureStream(); // warm mic (pre-acquired on panel open) — no cold start
      const ctx = getCtx();
      const analyser = analyserRef.current!;

      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      const live: Peak[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        cancelAnimationFrame(rafRef.current);
        // keep the stream/analyser warm for the next take — only released on unmount
        recDurRef.current = ctx.currentTime - recStartRef.current;
        youPeaksRef.current = live;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        blobUrlRef.current = URL.createObjectURL(blob);
        setHasRec(true);
        startPlayback(); // auto-play + sets phase 'play'
      };
      recorderRef.current = rec;

      recStartRef.current = ctx.currentTime;
      const data = new Float32Array(analyser.fftSize);
      const loop = () => {
        analyser.getFloatTimeDomainData(data);
        let m = 0;
        for (let i = 0; i < data.length; i++) { const av = Math.abs(data[i]); if (av > m) m = av; }
        const t = ctx.currentTime - recStartRef.current;
        live.push({ t, v: m });
        render(live, maxDur, Math.min(t, maxDur));
        if (t >= maxDur) { stopRecording(); return; } // cap = reference length at current rate
        rafRef.current = requestAnimationFrame(loop);
      };
      rec.start();
      setPhase('rec');
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      console.warn('[RecordCompare] mic start failed', err);
      setError('마이크 권한이 필요합니다. 브라우저 설정에서 허용하세요.');
      setPhase('idle');
    }
  }, [maxDur, render, startPlayback, stopRecording, ensureStream]);

  // o = record toggle. rec→stop(→autoplay); play→stop then record; idle→record.
  const toggleRecord = useCallback(() => {
    if (phase === 'rec') { stopRecording(); return; }
    if (phase === 'play') stopPlayback();
    if (phase === 'refplay') stopRefPlay();
    startRecording();
  }, [phase, startRecording, stopRecording, stopPlayback, stopRefPlay]);

  // p = play recording. rec→stop (autoplays); else play from start.
  const playRecording = useCallback(() => {
    if (phase === 'rec') { stopRecording(); return; }
    if (phase === 'play') stopPlayback();
    if (phase === 'refplay') stopRefPlay();
    if (hasRec) startPlayback();
  }, [phase, hasRec, stopRecording, stopPlayback, stopRefPlay, startPlayback]);

  // Own keydown: o=record toggle, p=play recording, r=play reference. Mounted only when panel ON.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyO') { e.preventDefault(); toggleRecord(); }
      else if (e.code === 'KeyP') { e.preventDefault(); playRecording(); }
      else if (e.code === 'KeyR') { e.preventDefault(); playReference(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRecord, playRecording, playReference]);

  // Cleanup on unmount
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (refPlayingRef.current) onStopOriginal();
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    audioElRef.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const durLabel = (d: number) => (d > 0 ? `${d.toFixed(1)}s` : '');

  return (
    <Paper elevation={2} sx={{ mx: { xs: 1, sm: 2 }, mb: 1, p: 1.5, flexShrink: 0 }}>
      <Stack ref={wrapRef} spacing={0.5} sx={{ width: '100%' }}>
        <Typography variant="caption" color="text.secondary">REFERENCE  {durLabel(refDur)}</Typography>
        <canvas ref={refCanvasRef} style={{ width: '100%', height: CANVAS_H, display: 'block' }} />
        <Typography variant="caption" color={phase === 'rec' ? 'error' : 'text.secondary'}>
          {phase === 'rec' ? `● 녹음 중… (최대 ${durLabel(maxDur)})` : `YOU  ${durLabel(recDurRef.current)} / 목표 ${durLabel(maxDur)}`}
        </Typography>
        <canvas ref={youCanvasRef} style={{ width: '100%', height: CANVAS_H, display: 'block' }} />

        {!audioBuffer && <Typography variant="caption" color="warning.main">원본 오디오 로딩 중…</Typography>}
        {error && <Typography variant="caption" color="error">{error}</Typography>}

        <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" sx={{ pt: 0.5 }}>
          <Tooltip title="녹음 시작/정지 (o)">
            <IconButton onClick={toggleRecord} color="error" size="small"
              sx={phase === 'rec' ? { animation: 'rc-pulse 1s infinite', '@keyframes rc-pulse': { '50%': { opacity: 0.3 } } } : undefined}>
              {phase === 'rec' ? <Stop /> : <FiberManualRecord />}
            </IconButton>
          </Tooltip>
          <Tooltip title="내 녹음 재생 (p)">
            <span>
              <IconButton onClick={playRecording} disabled={!hasRec || phase === 'rec'}
                color={phase === 'play' ? 'primary' : 'default'} size="small">
                <GraphicEq />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="원본 재생 (r)">
            <span>
              <IconButton onClick={playReference} disabled={!audioBuffer || phase === 'rec'}
                color={phase === 'refplay' ? 'primary' : 'default'} size="small">
                <PlayArrow />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>
    </Paper>
  );
}
