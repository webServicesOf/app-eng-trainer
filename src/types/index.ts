// Article 데이터 모델
export interface Article {
  id: string;
  number?: number; // Number 컬럼
  topic?: string; // Topic 컬럼
  title: string; // Head 컬럼
  difficulty?: string; // Difficulty 컬럼
  length?: string; // Length 컬럼
  content: string; // 전체 영어 텍스트
  sentences: SentenceEntry[];
  sheetName?: string; // 스프레드시트 탭 이름
  sheetRow?: number; // 1-based row index in spreadsheet (for write-back)
  nextReviewDate: Date | null;
  reviewInterval: number; // days
  createdAt: Date;
  lastAccessed: Date;
}

// 단어 타임스탬프 (Whisper word alignment)
export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

// 문장 엔트리
export interface SentenceEntry {
  index: number;
  text: string; // 영어 문장
  start?: number; // seconds (audio seek용, 자동 추정 → 에디터에서 수정)
  end?: number; // seconds
  words?: WordTimestamp[]; // Whisper word-level timestamps (optional)
  memo?: string;
}

// Audio 기반 Article (full mp3 + sentences.json 업로드)
export interface AudioArticle {
  id: string;
  title: string;
  audioBlob?: Blob; // full mp3 (IndexedDB 저장용)
  audioUrl?: string; // blob URL (런타임 전용, 저장 안 함)
  sentences: SentenceEntry[];
  splitPoints?: number[]; // sentence indices where splits occur (for SubDeck reconstruction)
  source?: string; // YouTube URL 등
  nextReviewDate: Date | null;
  reviewInterval: number; // days
  createdAt: Date;
  lastAccessed: Date;
}

// SubDeck — AudioArticle의 문장 범위 참조
export interface SubDeck {
  id: string;
  parentId: string; // AudioArticle ID
  title: string;
  startIndex: number; // 0-based inclusive
  endIndex: number; // 0-based exclusive
  nextReviewDate: Date | null;
  reviewInterval: number; // days
  createdAt: Date;
  lastAccessed: Date;
}

// Google Sheets 설정
export interface GoogleSheetsConfig {
  spreadsheetId: string;
  range: string; // 예: 'Sheet1!A:E'
  hasHeader: boolean; // 첫 번째 행이 헤더인지 여부
}

// OAuth 인증 상태
export interface AuthState {
  accessToken: string | null;
  isAuthenticated: boolean;
}

// UI 상태 관련 타입들
export interface LearningState {
  currentIndex: number;
  isPlaying: boolean;
  isCumulative: boolean; // 누적 표시 모드
}

export interface AppState {
  articles: Article[];
  isLoading: boolean;
  error: string | null;
  googleSheetsConfig: GoogleSheetsConfig | null;
}

// 저장된 문장
export interface SavedSentence {
  id: string;
  articleId: string;
  articleTitle: string;
  sentenceIndex: number;
  text: string;
  savedAt: Date;
}

// API 응답 타입들
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
