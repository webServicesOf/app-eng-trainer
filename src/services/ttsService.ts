/**
 * Web Speech API를 활용한 TTS(Text-to-Speech) 서비스
 */
export class TTSService {
  private synth: SpeechSynthesis;
  private utterance: SpeechSynthesisUtterance | null = null;
  private rate: number = 1.0; // 기본 속도
  private highlightCallback: ((charIndex: number, charLength: number) => void) | null = null;
  private highlightInterval: NodeJS.Timeout | null = null;
  private onboundarySupported: boolean = false; // onboundary 이벤트 작동 여부
  private boundaryEventFired: boolean = false; // 이 재생에서 boundary 이벤트 발생 여부

  constructor() {
    this.synth = window.speechSynthesis;
  }

  /**
   * 재생 속도 설정
   */
  setRate(rate: number): void {
    this.rate = rate;
  }

  /**
   * 현재 재생 속도 가져오기
   */
  getRate(): number {
    return this.rate;
  }

  /**
   * 텍스트를 음성으로 읽기
   */
  speak(text: string, onEnd?: () => void): void {
    // 이전 음성 중지
    this.stop();

    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.lang = 'en-US'; // 영어 음성
    this.utterance.rate = this.rate; // 설정된 속도 사용
    this.utterance.pitch = 1.0; // 음높이 (0 ~ 2)
    this.utterance.volume = 1.0; // 볼륨 (0 ~ 1)

    if (onEnd) {
      this.utterance.onend = onEnd;
    }

    this.synth.speak(this.utterance);
  }

  /**
   * 단어별로 음성 재생 (하이라이팅용)
   */
  speakWithHighlight(
    text: string,
    onWordBoundary?: (charIndex: number, charLength: number) => void,
    onEnd?: () => void,
    startFromText?: string
  ): void {
    this.stop();

    // 이 재생에 대해 boundary 이벤트 발생 여부 초기화
    this.boundaryEventFired = false;

    // If startFromText is provided, find its position and extract substring
    let textToSpeak = text;
    let offset = 0;
    if (startFromText) {
      const startIndex = text.indexOf(startFromText);
      if (startIndex !== -1) {
        textToSpeak = text.substring(startIndex);
        offset = startIndex;
      }
    }

    this.utterance = new SpeechSynthesisUtterance(textToSpeak);
    this.utterance.lang = 'en-US';
    this.utterance.rate = this.rate;
    this.utterance.pitch = 1.0;
    this.utterance.volume = 1.0;

    // 콜백 저장 (폴백용)
    this.highlightCallback = onWordBoundary || null;

    if (onWordBoundary) {
      // Primary: onboundary 이벤트 시도
      this.utterance.onboundary = (event) => {
        if (event.name === 'word') {
          // onboundary 이벤트 발생 확인
          this.boundaryEventFired = true;
          this.onboundarySupported = true;

          // Adjust charIndex by offset to match original text
          onWordBoundary(event.charIndex + offset, event.charLength || 0);
        }
      };
    }

    if (onEnd) {
      this.utterance.onend = onEnd;
    }

    // Fallback: onboundary가 작동하지 않을 경우를 대비한 폴백 메커니즘
    // 음성 재생 시작 후 정기적으로 현재 위치 추정
    this.setupFallbackHighlight(textToSpeak, offset, onWordBoundary);

    this.synth.speak(this.utterance);
  }

  /**
   * onboundary 이벤트 미지원 시 폴백: 추정된 위치로 하이라이트 업데이트
   */
  private setupFallbackHighlight(
    text: string,
    offset: number,
    onWordBoundary?: (charIndex: number, charLength: number) => void
  ): void {
    if (!onWordBoundary || !this.utterance) return;

    // 단어 배열 생성
    const words = text.match(/\S+/g) || [];
    let wordIndex = 0;
    let charPosition = 0;
    let estimatedDuration = this.estimateSpeakDuration(text);

    // 음성 재생 시간 기반 폴백
    let elapsedTime = 0;
    const updateInterval = 100; // 100ms마다 확인
    const wordDuration = estimatedDuration / Math.max(words.length, 1);

    // onboundary 이벤트 감지 대기 시간 (200ms 후 onboundary 미수신시 폴백 활성화)
    const boundaryDetectionTimeout = 200;
    let boundaryDetectionTimer: NodeJS.Timeout | null = null;
    let fallbackActive = false;

    // onboundary 이벤트 감지 대기
    boundaryDetectionTimer = setTimeout(() => {
      if (!this.boundaryEventFired && !fallbackActive) {
        // onboundary 이벤트가 발생하지 않음 → 폴백 활성화
        fallbackActive = true;
      }
    }, boundaryDetectionTimeout);

    this.highlightInterval = setInterval(() => {
      if (!this.synth.speaking || !this.utterance) {
        clearInterval(this.highlightInterval!);
        if (boundaryDetectionTimer) clearTimeout(boundaryDetectionTimer);
        return;
      }

      // onboundary 이벤트가 발생했으면 폴백 비활성화
      if (this.boundaryEventFired) {
        fallbackActive = false;
      }

      // 폴백이 활성화되지 않으면 동작하지 않음
      if (!fallbackActive) {
        return;
      }

      elapsedTime += updateInterval;
      const estimatedWordIndex = Math.floor(elapsedTime / wordDuration);

      if (estimatedWordIndex < words.length && estimatedWordIndex !== wordIndex) {
        wordIndex = estimatedWordIndex;
        const word = words[wordIndex];
        const charIndex = text.indexOf(word, charPosition);
        charPosition = charIndex + word.length;

        if (charIndex !== -1) {
          onWordBoundary(charIndex + offset, word.length);
        }
      }
    }, updateInterval);
  }

  /**
   * 텍스트의 예상 재생 시간 계산 (밀리초)
   */
  private estimateSpeakDuration(text: string): number {
    // 평균 영어 음성 속도: 150-160 단어/분 = 2.5 단어/초
    // 단어당 400ms 기본값 (rate 1.0 기준)
    const baseWordDuration = 400;
    const words = text.match(/\S+/g) || [];
    const wordCount = words.length;
    const baseDuration = wordCount * baseWordDuration;

    // rate에 따라 조정 (rate가 높을수록 빨라짐)
    return baseDuration / Math.max(this.rate, 0.1);
  }

  /**
   * 음성 중지
   */
  stop(): void {
    // 폴백 인터벌 정리
    if (this.highlightInterval) {
      clearInterval(this.highlightInterval);
      this.highlightInterval = null;
    }

    if (this.synth.speaking) {
      this.synth.cancel();
    }
  }

  /**
   * 일시정지
   */
  pause(): void {
    if (this.synth.speaking) {
      this.synth.pause();
    }
  }

  /**
   * 재개
   */
  resume(): void {
    if (this.synth.paused) {
      this.synth.resume();
    }
  }

  /**
   * 현재 재생 중인지 확인
   */
  isSpeaking(): boolean {
    return this.synth.speaking;
  }

  /**
   * 사용 가능한 음성 목록 가져오기
   */
  getVoices(): SpeechSynthesisVoice[] {
    return this.synth.getVoices();
  }

  /**
   * 특정 음성 설정
   */
  setVoice(voiceURI: string): void {
    const voices = this.getVoices();
    const voice = voices.find((v) => v.voiceURI === voiceURI);
    if (voice && this.utterance) {
      this.utterance.voice = voice;
    }
  }
}

export const ttsService = new TTSService();
