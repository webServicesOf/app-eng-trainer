/**
 * Web Speech API를 활용한 TTS(Text-to-Speech) 서비스
 */
export class TTSService {
  private synth: SpeechSynthesis;
  private utterance: SpeechSynthesisUtterance | null = null;
  private rate: number = 1.0; // 기본 속도

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

    if (onWordBoundary) {
      this.utterance.onboundary = (event) => {
        if (event.name === 'word') {
          // Adjust charIndex by offset to match original text
          onWordBoundary(event.charIndex + offset, event.charLength || 0);
        }
      };
    }

    if (onEnd) {
      this.utterance.onend = onEnd;
    }

    this.synth.speak(this.utterance);
  }

  /**
   * 음성 중지
   */
  stop(): void {
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
