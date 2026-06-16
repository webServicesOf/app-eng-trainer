import { SentenceEntry } from '../types';

class AudioSeekService {
  private audio: HTMLAudioElement;
  private pauseTimer: number | null = null;
  private onEndCallback: (() => void) | null = null;
  private onSentenceChange: ((sentenceIndex: number) => void) | null = null;
  private onWordChange: ((sentenceIndex: number, wordIndex: number) => void) | null = null;
  private trackingSentences: SentenceEntry[] = [];
  private lastReportedSentence: number = -1;
  private lastReportedWord: number = -1;
  public wordTimingOffset: number = 0; // seconds: positive = highlights earlier, negative = later
  private playId: number = 0; // monotonic counter to invalidate stale play calls
  private rafId: number = 0; // requestAnimationFrame handle

  // Segment-chaining state (for gapped playback with hidden sentences)
  private segments: SentenceEntry[] = [];
  private currentSegmentIdx: number = -1;
  private segmentMode: boolean = false;

  constructor() {
    this.audio = new Audio();
  }

  private targetEndTime: number = 0;

  /** rAF-driven tracking loop — runs at ~60fps while audio is playing */
  private trackingLoop = () => {
    if (this.audio.paused) {
      this.rafId = 0;
      return;
    }

    this.pollTime();
    this.rafId = requestAnimationFrame(this.trackingLoop);
  };

  private startTrackingLoop(): void {
    if (this.rafId) return; // already running
    this.rafId = requestAnimationFrame(this.trackingLoop);
  }

  private stopTrackingLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private pollTime(): void {
    const t = this.audio.currentTime;

    // Segment-chaining mode: check current segment end → advance to next
    if (this.segmentMode && this.currentSegmentIdx >= 0) {
      const seg = this.segments[this.currentSegmentIdx];
      if (seg?.end != null && t >= seg.end) {
        const nextIdx = this.currentSegmentIdx + 1;
        if (nextIdx < this.segments.length) {
          // Jump to next segment
          this.currentSegmentIdx = nextIdx;
          const nextSeg = this.segments[nextIdx];
          if (nextSeg?.start != null) {
            this.audio.currentTime = nextSeg.start;
            this.targetEndTime = nextSeg.end ?? 0;
            this.lastReportedSentence = -1;
            this.lastReportedWord = -1;
            if (this.onSentenceChange) this.onSentenceChange(nextIdx);
          }
          return;
        } else {
          // All segments done
          this.audio.pause();
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

    // Non-segment mode: original end-time check
    if (!this.segmentMode && this.targetEndTime > 0 && t >= this.targetEndTime) {
      this.audio.pause();
      this.targetEndTime = 0;
      this.stopTrackingLoop();
      this.clearTracking();
      if (this.onEndCallback) {
        this.onEndCallback();
        this.onEndCallback = null;
      }
      return;
    }

    // Track which sentence + word is currently playing
    if (this.segmentMode && this.currentSegmentIdx >= 0) {
      // In segment mode, current sentence = currentSegmentIdx
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

  /** Immediately pause + invalidate any pending play() promise */
  private cancelAndPause(): void {
    this.playId++;
    this.audio.pause();
    this.stopTrackingLoop();
  }

  /** Start playback; stale plays are killed via playId check */
  private startPlay(): void {
    const id = ++this.playId;
    this.audio.play().then(
      () => {
        if (this.playId !== id) {
          this.audio.pause();
        } else {
          this.startTrackingLoop();
        }
      },
      () => {
        // AbortError from interrupted play — expected during rapid navigation
      },
    );
  }

  load(blobUrl: string): Promise<void> {
    return new Promise((resolve) => {
      this.audio.addEventListener('canplaythrough', () => resolve(), { once: true });
      this.audio.src = blobUrl;
      this.audio.load();
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
    this.clearPauseTimer();
    this.cancelAndPause();
    this.clearTracking();
    this.audio.currentTime = start;
    this.targetEndTime = end;
    this.onEndCallback = onEnd || null;
    if (sentences) {
      this.trackingSentences = sentences;
      this.onSentenceChange = onSentenceChange || null;
      this.onWordChange = onWordChange || null;
    }
    this.startPlay();
  }

  /**
   * Play multiple sentence segments sequentially, seeking between gaps.
   * Each sentence's [start, end] is played in order; gaps (hidden sentences) are skipped.
   */
  playSegments(
    segments: SentenceEntry[],
    onEnd?: () => void,
    onSentenceChange?: (index: number) => void,
    onWordChange?: (sentenceIdx: number, wordIdx: number) => void,
  ): void {
    this.clearPauseTimer();
    this.cancelAndPause();
    this.clearTracking();
    if (segments.length === 0) return;

    const firstSeg = segments[0];
    if (firstSeg.start == null || firstSeg.end == null) return;

    this.segmentMode = true;
    this.segments = segments;
    this.currentSegmentIdx = 0;
    this.audio.currentTime = firstSeg.start;
    this.targetEndTime = firstSeg.end;
    this.onEndCallback = onEnd || null;
    this.onSentenceChange = onSentenceChange || null;
    this.onWordChange = onWordChange || null;
    if (onSentenceChange) onSentenceChange(0);
    this.startPlay();
  }

  playCumulative(
    sentences: SentenceEntry[],
    upTo: number,
    onEnd?: () => void,
    onSentenceChange?: (index: number) => void,
    onWordChange?: (sentenceIdx: number, wordIdx: number) => void,
  ): void {
    // Use segment-chaining: play each sentence's [start,end] individually
    const segs = sentences.slice(0, upTo + 1).filter(s => s.start != null && s.end != null);
    this.playSegments(segs, onEnd, onSentenceChange, onWordChange);
  }

  stop(): void {
    this.clearPauseTimer();
    this.cancelAndPause();
    this.audio.currentTime = 0;
    this.targetEndTime = 0;
    this.segmentMode = false;
    this.currentSegmentIdx = -1;
    this.segments = [];
    this.onEndCallback = null;
  }

  pause(): void {
    this.clearPauseTimer();
    this.cancelAndPause();
    // Keep segment state for resume
  }

  resume(): void {
    // Restore targetEndTime for segment mode
    if (this.segmentMode && this.currentSegmentIdx >= 0) {
      const seg = this.segments[this.currentSegmentIdx];
      if (seg?.end != null) this.targetEndTime = seg.end;
    }
    this.startPlay();
  }

  setRate(rate: number): void {
    this.audio.playbackRate = rate;
  }

  getRate(): number {
    return this.audio.playbackRate;
  }

  isPlaying(): boolean {
    return !this.audio.paused;
  }

  getCurrentTime(): number {
    return this.audio.currentTime;
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer !== null) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  dispose(): void {
    this.clearPauseTimer();
    this.stopTrackingLoop();
    this.cancelAndPause();
    this.audio.src = '';
  }
}

export const audioSeekService = new AudioSeekService();
