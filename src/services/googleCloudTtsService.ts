/**
 * Google Cloud Text-to-Speech 서비스
 * 자연스러운 음성 품질과 안정적인 브라우저 호환성 제공
 */
export class GoogleCloudTTSService {
  private apiKey: string = '';
  private currentAudio: HTMLAudioElement | null = null;
  private highlightCallback: ((charIndex: number, charLength: number) => void) | null = null;
  private rate: number = 1.0;

  constructor() {
    // localStorage에서 API 키 가져오기
    const key = localStorage.getItem('google_cloud_tts_api_key');
    if (key) {
      this.apiKey = key;
    }
  }

  /**
   * API 키 설정
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    localStorage.setItem('google_cloud_tts_api_key', apiKey);
  }

  /**
   * API 키 가져오기
   */
  getApiKey(): string {
    return this.apiKey;
  }

  /**
   * 재생 속도 설정
   */
  setRate(rate: number): void {
    this.rate = rate;
    if (this.currentAudio) {
      this.currentAudio.playbackRate = rate;
    }
  }

  /**
   * 현재 재생 속도 가져오기
   */
  getRate(): number {
    return this.rate;
  }

  /**
   * 텍스트를 음성으로 읽기 (하이라이팅용)
   */
  async speakWithHighlight(
    text: string,
    onWordBoundary?: (charIndex: number, charLength: number) => void,
    onEnd?: () => void,
    startFromText?: string
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Google Cloud TTS API key not set');
    }

    this.stop();

    try {
      // 1. Google Cloud TTS API 호출해서 오디오 생성
      const audioContent = await this.synthesizeSpeech(text);

      // 2. 오디오 재생 설정
      const audioBlob = this._base64ToBlob(audioContent, 'audio/mpeg');
      const audioUrl = URL.createObjectURL(audioBlob);

      this.currentAudio = new Audio(audioUrl);
      this.currentAudio.playbackRate = this.rate;

      // 3. 단어 타이밍 정보 설정
      if (onWordBoundary) {
        this.highlightCallback = onWordBoundary;
        this._setupWordBoundaryTracking(text, startFromText);
      }

      // 4. 재생 종료 콜백
      if (onEnd) {
        this.currentAudio.onended = onEnd;
      }

      // 5. 오디오 재생
      this.currentAudio.play();
    } catch (error) {
      console.error('Failed to speak:', error);
      throw error;
    }
  }

  /**
   * Google Cloud Text-to-Speech API 호출
   */
  private async synthesizeSpeech(text: string): Promise<string> {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: 'en-US',
            name: 'en-US-Neural2-C', // 자연스러운 남성 음성
          },
          audioConfig: {
            audioEncoding: 'MP3',
            pitch: 0,
            speakingRate: 1, // Google API에서는 별도로 설정
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Google Cloud TTS API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.audioContent;
  }

  /**
   * 단어 경계 추적 (onboundary 이벤트 에뮬레이션)
   * Web Speech API의 onboundary 이벤트를 모방하기 위해
   * 단어 시작 시간을 기반으로 하이라이트 업데이트
   */
  private _setupWordBoundaryTracking(text: string, startFromText?: string): void {
    if (!this.currentAudio) return;

    // 텍스트 정규화
    let textToUse = text;
    let offset = 0;

    if (startFromText) {
      const startIndex = text.indexOf(startFromText);
      if (startIndex !== -1) {
        textToUse = text.substring(startIndex);
        offset = startIndex;
      }
    }

    // 단어 분리 및 위치 계산
    const words = textToUse.match(/\S+/g) || [];
    if (words.length === 0) return;

    // 단어별 시작 시간 추정
    // Google Cloud TTS는 안정적인 음성 속도를 제공함
    // 1배속에서는 느리고 1.4배속에서 적당하므로, 기본값을 높여서 보정
    const wordTimings: { word: string; charIndex: number; startTime: number }[] = [];
    let searchStart = 0;
    let cumulativeTime = 0;
    // 기본 320ms/단어 (원래 400ms보다 20% 빠름)
    // rate 1.0: 320ms
    // rate 1.4: 229ms (1.4배 빨라짐)
    const baseWordDuration = 320;
    const wordDuration = baseWordDuration / this.rate; // rate에 따라 조정

    for (const word of words) {
      const charIndex = textToUse.indexOf(word, searchStart);
      if (charIndex !== -1) {
        wordTimings.push({
          word,
          charIndex,
          startTime: cumulativeTime,
        });

        cumulativeTime += wordDuration;
        searchStart = charIndex + word.length;
      }
    }

    // 주기적으로 현재 재생 시간을 확인하고 하이라이트 업데이트
    let lastHighlightedIndex = -1;

    const updateInterval = setInterval(() => {
      if (!this.currentAudio || (this.currentAudio.paused && !this.currentAudio.ended)) {
        // 재생 중이 아니면 중단
        if (!this.currentAudio?.ended) {
          clearInterval(updateInterval);
        }
        return;
      }

      const currentTime = (this.currentAudio?.currentTime || 0) * 1000; // ms로 변환

      // 현재 재생 시간에 해당하는 단어 찾기
      for (let i = 0; i < wordTimings.length; i++) {
        const timing = wordTimings[i];
        const nextTiming = wordTimings[i + 1];
        const nextStartTime = nextTiming ? nextTiming.startTime : Infinity;

        if (currentTime >= timing.startTime && currentTime < nextStartTime) {
          // 새로운 단어로 업데이트된 경우만 콜백 호출
          if (i !== lastHighlightedIndex && this.highlightCallback) {
            lastHighlightedIndex = i;
            this.highlightCallback(timing.charIndex + offset, timing.word.length);
          }
          return;
        }
      }

      // 재생 종료 시 interval 정리
      if (this.currentAudio?.ended) {
        clearInterval(updateInterval);
      }
    }, 30); // 30ms마다 확인
  }

  /**
   * 음성 중지
   */
  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this.highlightCallback = null;
  }

  /**
   * 일시정지
   */
  pause(): void {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
    }
  }

  /**
   * 재개
   */
  resume(): void {
    if (this.currentAudio && this.currentAudio.paused) {
      this.currentAudio.play();
    }
  }

  /**
   * 현재 재생 중인지 확인
   */
  isSpeaking(): boolean {
    return this.currentAudio ? !this.currentAudio.paused : false;
  }

  /**
   * Base64 문자열을 Blob으로 변환
   */
  private _base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }
}

export const googleCloudTtsService = new GoogleCloudTTSService();
