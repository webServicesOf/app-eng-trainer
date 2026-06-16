import { SentenceEntry } from '../types';

class AudioSeekService {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;

  private _isPlaying: boolean = false;
  private _playbackRate: number = 1;
  private startOffset: number = 0; // where in the buffer playback started
  private startedAt: number = 0; // ctx.currentTime when playback started

  private onEndCallback: (() => void) | null = null;
  private onSentenceChange: ((sentenceIndex: number) => void) | null = null;
  private onWordChange: ((sentenceIndex: number, wordIndex: number) => void) | null = null;
  private trackingSentences: SentenceEntry[] = [];
  private lastReportedSentence: number = -1;
  private lastReportedWord: number = -1;
  public wordTimingOffset: number = 0;
  private playId: number = 0;
  private rafId: number = 0;

  private targetEndTime: number = 0;

  // Segment-chaining state
  private segments: SentenceEntry[] = [];
  private currentSegmentIdx: number = -1;
  private segmentMode: boolean = false;

  // Pause snapshot
  private pausedOffset: number = 0;

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  /** rAF-driven tracking loop */
  private trackingLoop = () => {
    if (!this._isPlaying) {
      this.rafId = 0;
      return;
    }
    this.pollTime();
    this.rafId = requestAnimationFrame(this.trackingLoop);
  };

  private startTrackingLoop(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(this.trackingLoop);
  }

  private stopTrackingLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private pollTime(): void {
    const t = this.getCurrentTime();

    // Segment-chaining mode
    if (this.segmentMode && this.currentSegmentIdx >= 0) {
      const seg = this.segments[this.currentSegmentIdx];
      if (seg?.end != null && t >= seg.end) {
        const nextIdx = this.currentSegmentIdx + 1;
        if (nextIdx < this.segments.length) {
          this.currentSegmentIdx = nextIdx;
          const nextSeg = this.segments[nextIdx];
          if (nextSeg?.start != null) {
            this.targetEndTime = nextSeg.end ?? 0;
            this.lastReportedSentence = -1;
            this.lastReportedWord = -1;
            if (this.onSentenceChange) this.onSentenceChange(nextIdx);
            this.playFromOffset(nextSeg.start);
          }
          return;
        } else {
          // All segments done
          this.stopCurrentSource();
          this._isPlaying = false;
          this.targetEndTime = 0;
          this.segmentMode = false;
          this.currentSegmentIdx = -1;
          this.stopTrackingLoop();
          this.clearTracking();
          if (this.onEndCallback) {
            this.onEndCallback();
            this.onEndCallback = null;
          }
          return;
        }
      }
    }

    // Non-segment: end-time check
    if (!this.segmentMode && this.targetEndTime > 0 && t >= this.targetEndTime) {
      this.stopCurrentSource();
      this._isPlaying = false;
      this.targetEndTime = 0;
      this.stopTrackingLoop();
      this.clearTracking();
      if (this.onEndCallback) {
        this.onEndCallback();
        this.onEndCallback = null;
      }
      return;
    }

    // Track sentence + word
    if (this.segmentMode && this.currentSegmentIdx >= 0) {
      const i = this.currentSegmentIdx;
      const s = this.segments[i];
      if (s && s.start != null && s.end != null) {
        if (i !== this.lastReportedSentence) {
          this.lastReportedSentence = i;
          this.lastReportedWord = -1;
          if (this.onSentenceChange) this.onSentenceChange(i);
        }
        this.trackWord(s, i, t);
      }
    } else if (this.trackingSentences.length > 0) {
      for (let i = this.trackingSentences.length - 1; i >= 0; i--) {
        const s = this.trackingSentences[i];
        if (s.start != null && t >= s.start) {
          if (i !== this.lastReportedSentence) {
            this.lastReportedSentence = i;
            this.lastReportedWord = -1;
            if (this.onSentenceChange) this.onSentenceChange(i);
          }
          this.trackWord(s, i, t);
          break;
        }
      }
    }
  }

  private trackWord(s: SentenceEntry, sentIdx: number, t: number): void {
    if (!this.onWordChange || s.start == null || s.end == null) return;
    const textWordCount = s.text.split(/\s+/).length;
    let wordIdx = -1;
    if (s.words && s.words.length > 0) {
      const adjustedT = t + this.wordTimingOffset;
      for (let w = Math.min(s.words.length, textWordCount) - 1; w >= 0; w--) {
        if (adjustedT >= s.words[w].start) {
          wordIdx = w;
          break;
        }
      }
    } else {
      const dur = s.end - s.start;
      const elapsed = t - s.start;
      wordIdx = Math.min(Math.floor((elapsed / dur) * textWordCount), textWordCount - 1);
    }
    wordIdx = Math.min(wordIdx, textWordCount - 1);
    if (wordIdx !== this.lastReportedWord && wordIdx >= 0) {
      this.lastReportedWord = wordIdx;
      this.onWordChange(sentIdx, wordIdx);
    }
  }

  private clearTracking(): void {
    this.trackingSentences = [];
    this.lastReportedSentence = -1;
    this.lastReportedWord = -1;
    this.onSentenceChange = null;
    this.onWordChange = null;
  }

  private stopCurrentSource(): void {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch { /* already stopped */ }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  /** Immediately stop + invalidate any pending play */
  private cancelAndPause(): void {
    this.playId++;
    this.stopCurrentSource();
    this._isPlaying = false;
    this.stopTrackingLoop();
  }

  /** Core: play buffer from offset with sample-accurate seek */
  private playFromOffset(offset: number): void {
    const ctx = this.ensureContext();
    if (!this.buffer) return;

    this.stopCurrentSource();

    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this._playbackRate;
    source.connect(ctx.destination);

    // Handle natural end of source
    source.onended = () => {
      if (this.sourceNode === source) {
        // Only handle if this is still the active source
        // pollTime will handle end-of-segment/sentence logic
      }
    };

    source.start(0, offset);
    this.sourceNode = source;
    this.startOffset = offset;
    this.startedAt = ctx.currentTime;
    this._isPlaying = true;
  }

  /** Start playback with playId race protection + autoplay policy */
  private async startPlay(offset: number): Promise<void> {
    const ctx = this.ensureContext();
    const id = ++this.playId;

    // Handle autoplay policy
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (this.playId !== id) return; // stale

    this.playFromOffset(offset);
    this.startTrackingLoop();
  }

  load(blobUrl: string): Promise<void> {
    const ctx = this.ensureContext();
    return fetch(blobUrl)
      .then(res => res.arrayBuffer())
      .then(arrayBuf => ctx.decodeAudioData(arrayBuf))
      .then(decoded => {
        this.buffer = decoded;
      });
  }

  playSentence(
    start: number,
    end: number,
    onEnd?: () => void,
    onSentenceChange?: (index: number) => void,
    sentences?: SentenceEntry[],
    onWordChange?: (sentenceIdx: number, wordIdx: number) => void,
  ): void {
    this.cancelAndPause();
    this.clearTracking();
    this.segmentMode = false;
    this.targetEndTime = end;
    this.onEndCallback = onEnd || null;
    if (sentences) {
      this.trackingSentences = sentences;
      this.onSentenceChange = onSentenceChange || null;
      this.onWordChange = onWordChange || null;
    }
    this.startPlay(start);
  }

  playSegments(
    segments: SentenceEntry[],
    onEnd?: () => void,
    onSentenceChange?: (index: number) => void,
    onWordChange?: (sentenceIdx: number, wordIdx: number) => void,
  ): void {
    this.cancelAndPause();
    this.clearTracking();
    if (segments.length === 0) return;

    const firstSeg = segments[0];
    if (firstSeg.start == null || firstSeg.end == null) return;

    this.segmentMode = true;
    this.segments = segments;
    this.currentSegmentIdx = 0;
    this.targetEndTime = firstSeg.end;
    this.onEndCallback = onEnd || null;
    this.onSentenceChange = onSentenceChange || null;
    this.onWordChange = onWordChange || null;
    if (onSentenceChange) onSentenceChange(0);
    this.startPlay(firstSeg.start);
  }

  playCumulative(
    sentences: SentenceEntry[],
    upTo: number,
    onEnd?: () => void,
    onSentenceChange?: (index: number) => void,
    onWordChange?: (sentenceIdx: number, wordIdx: number) => void,
  ): void {
    const segs = sentences.slice(0, upTo + 1).filter(s => s.start != null && s.end != null);
    this.playSegments(segs, onEnd, onSentenceChange, onWordChange);
  }

  stop(): void {
    this.cancelAndPause();
    this.targetEndTime = 0;
    this.segmentMode = false;
    this.currentSegmentIdx = -1;
    this.segments = [];
    this.onEndCallback = null;
    this.pausedOffset = 0;
  }

  pause(): void {
    if (!this._isPlaying) return;
    this.pausedOffset = this.getCurrentTime();
    this.playId++;
    this.stopCurrentSource();
    this._isPlaying = false;
    this.stopTrackingLoop();
    // Keep segment state for resume
  }

  resume(): void {
    if (this._isPlaying) return;
    // Restore targetEndTime for segment mode
    if (this.segmentMode && this.currentSegmentIdx >= 0) {
      const seg = this.segments[this.currentSegmentIdx];
      if (seg?.end != null) this.targetEndTime = seg.end;
    }
    this.startPlay(this.pausedOffset);
  }

  setRate(rate: number): void {
    this._playbackRate = rate;
    if (this.sourceNode) {
      this.sourceNode.playbackRate.value = rate;
    }
  }

  getRate(): number {
    return this._playbackRate;
  }

  isPlaying(): boolean {
    return this._isPlaying;
  }

  getCurrentTime(): number {
    if (!this._isPlaying || !this.ctx) {
      return this.pausedOffset;
    }
    return this.startOffset + (this.ctx.currentTime - this.startedAt) * this._playbackRate;
  }

  dispose(): void {
    this.cancelAndPause();
    this.buffer = null;
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
    this.ctx = null;
  }
}

export const audioSeekService = new AudioSeekService();
