import { SentenceEntry } from '../types';

class AudioSeekService {
  private audio: HTMLAudioElement;
  private pauseTimer: number | null = null;
  private onEndCallback: (() => void) | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
  }

  private targetEndTime: number = 0;

  private handleTimeUpdate = () => {
    if (this.targetEndTime > 0 && this.audio.currentTime >= this.targetEndTime) {
      this.audio.pause();
      this.targetEndTime = 0;
      if (this.onEndCallback) {
        this.onEndCallback();
        this.onEndCallback = null;
      }
    }
  };

  load(blobUrl: string): void {
    this.audio.src = blobUrl;
    this.audio.load();
  }

  async playSentence(
    start: number,
    end: number,
    onEnd?: () => void
  ): Promise<void> {
    this.clearPauseTimer();
    this.audio.currentTime = start;
    this.targetEndTime = end;
    this.onEndCallback = onEnd || null;
    await this.audio.play();
  }

  async playCumulative(
    sentences: SentenceEntry[],
    upTo: number,
    onEnd?: () => void
  ): Promise<void> {
    this.clearPauseTimer();
    const startSentence = sentences[0];
    const endSentence = sentences[upTo];
    if (!startSentence?.start || !endSentence?.end) return;

    this.audio.currentTime = startSentence.start;
    this.targetEndTime = endSentence.end;
    this.onEndCallback = onEnd || null;
    await this.audio.play();
  }

  stop(): void {
    this.clearPauseTimer();
    this.audio.pause();
    this.audio.currentTime = 0;
    this.targetEndTime = 0;
    this.onEndCallback = null;
  }

  pause(): void {
    this.clearPauseTimer();
    this.audio.pause();
    this.targetEndTime = 0;
  }

  resume(): void {
    this.audio.play();
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
    this.audio.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.pause();
    this.audio.src = '';
  }
}

export const audioSeekService = new AudioSeekService();
