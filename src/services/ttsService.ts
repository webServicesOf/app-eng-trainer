/**
 * Web Speech API를 활용한 TTS(Text-to-Speech) 서비스
 */
export class TTSService {
  private synth: SpeechSynthesis;
  private utterance: SpeechSynthesisUtterance | null = null;
  private rate: number = 1.0; // 기본 속도
  private highlightCallback: ((charIndex: number, charLength: number) => void) | null = null;
  private highlightInterval: NodeJS.Timeout | null = null;
  private startTime: number = 0; // 재생 시작 시간
  private pausedTime: number = 0; // 일시정지된 총 시간

  constructor() {
    this.synth = window.speechSynthesis;
  }

  /**
   * 재생 속도 설정
   */
  setRate(rate: number): void {
    this.rate = rate;
    // 이미 재생 중인 utterance의 rate 변경
    if (this.utterance) {
      this.utterance.rate = rate;
    }
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
   * 시간 기반 정확한 추적 방식 사용
   */
  speakWithHighlight(
    text: string,
    onWordBoundary?: (charIndex: number, charLength: number) => void,
    onEnd?: () => void,
    startFromText?: string
  ): void {
    this.stop();

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

    if (onEnd) {
      this.utterance.onend = onEnd;
    }

    // 시간 기반 정확한 하이라이트 추적 시작
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.setupTimeBasedHighlight(textToSpeak, offset, onWordBoundary);

    this.synth.speak(this.utterance);
  }

  /**
   * 시간 기반 정확한 하이라이트 추적
   * 실제 경과 시간을 기반으로 현재 읽고 있는 단어를 판단
   */
  private setupTimeBasedHighlight(
    text: string,
    offset: number,
    onWordBoundary?: (charIndex: number, charLength: number) => void
  ): void {
    if (!onWordBoundary || !this.utterance) return;

    // 단어 배열과 시간 정보 미리 계산
    const words = text.match(/\S+/g) || [];
    if (words.length === 0) return;

    // 각 단어의 시작 위치와 예상 재생 시간 계산
    const wordTimings: { word: string; charIndex: number; startTime: number; endTime: number }[] = [];
    let searchStart = 0;
    const totalDuration = this.estimateSpeakDuration(text);
    const timePerWord = totalDuration / words.length;

    let cumulativeTime = 0;
    for (const word of words) {
      const charIndex = text.indexOf(word, searchStart);
      if (charIndex !== -1) {
        // 이 단어의 길이에 따라 시간 조정
        const wordLength = word.length;
        const avgWordLength = text.length / words.length;
        const wordSpecificDuration = timePerWord * (wordLength / avgWordLength);

        wordTimings.push({
          word,
          charIndex,
          startTime: cumulativeTime,
          endTime: cumulativeTime + wordSpecificDuration,
        });

        cumulativeTime += wordSpecificDuration;
        searchStart = charIndex + word.length;
      }
    }

    let lastHighlightedIndex = -1;

    this.highlightInterval = setInterval(() => {
      if (!this.synth.speaking || !this.utterance) {
        clearInterval(this.highlightInterval!);
        return;
      }

      // 현재 경과 시간 계산
      const elapsedTime = Date.now() - this.startTime - this.pausedTime;

      // 현재 읽고 있는 단어 찾기
      for (let i = 0; i < wordTimings.length; i++) {
        const timing = wordTimings[i];
        if (elapsedTime >= timing.startTime && elapsedTime < timing.endTime) {
          // 하이라이트 업데이트가 필요한 경우만 콜백 호출
          if (i !== lastHighlightedIndex) {
            lastHighlightedIndex = i;
            onWordBoundary(timing.charIndex + offset, timing.word.length);
          }
          return;
        }
      }
    }, 30); // 30ms마다 체크 (부드러운 업데이트)
  }

  /**
   * 텍스트의 예상 재생 시간 계산 (밀리초)
   */
  private estimateSpeakDuration(text: string): number {
    // 평균 영어 음성 속도: 150-160 단어/분 = 2.5 단어/초
    // 단어당 400ms 기본값 (rate 1.0 기준)
    // 문자 수도 고려하여 더 정확한 추정
    const baseWordDuration = 400;
    const baseCharDuration = 40; // 문자당 40ms (rate 1.0 기준)

    const words = text.match(/\S+/g) || [];
    const wordCount = words.length;

    // 단어 수와 문자 수를 모두 고려
    const wordBasedDuration = wordCount * baseWordDuration;
    const charBasedDuration = text.length * baseCharDuration / 5; // 평균 단어 길이 약 5자

    // 두 추정값의 평균 사용
    const baseDuration = (wordBasedDuration + charBasedDuration) / 2;

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
      // 일시정지 시간 기록 (재개될 때 차감하기 위해)
      this.pausedTime = Date.now() - this.startTime;
    }
  }

  /**
   * 재개
   */
  resume(): void {
    if (this.synth.paused) {
      this.synth.resume();
      // 일시정지 기간 계산 및 제거
      const pauseDuration = Date.now() - this.startTime - this.pausedTime;
      this.startTime += pauseDuration;
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
