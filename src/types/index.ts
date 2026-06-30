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
  hidden?: boolean; // 학습 모드에서 숨김 처리
}

// SubDeck의 복습 상태 (Drive JSON에 포함, 크로스 디바이스 동기화)
export interface SubDeckReview {
  startIndex: number; // SubDeck 식별 키 (startIndex + endIndex)
  endIndex: number;
  nextReviewDate?: string | null;
  reviewInterval: number;
  lastAccessed?: string;
  saved?: boolean; // 덱 저장 여부 (Drive SSOT)
}

// Audio 기반 Article (full mp3 + sentences.json 업로드)
export interface AudioArticle {
  id: string;
  title: string;
  audioBlob?: Blob; // full mp3 (IndexedDB 저장용)
  audioUrl?: string; // blob URL (런타임 전용, 저장 안 함)
  sentences: SentenceEntry[];
  splitPoints?: number[]; // sentence indices where splits occur (for SubDeck reconstruction)
  subDeckReviews?: SubDeckReview[]; // SubDeck별 복습 상태 (Drive SSOT)
  savedAsDeck?: boolean; // 전체 덱 저장 여부 (Drive SSOT)
  savedSentenceIndices?: number[]; // 저장된 문장 인덱스 (Drive SSOT)
  savedSentenceReview?: { reviewInterval: number; nextReviewDate: string | null }; // 저장 문장 덱 복습
  source?: string; // YouTube URL 등
  sentenceCount?: number; // index summary count (before full sentences loaded)
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

// Article summary for index.json manifest (lazy loading)
export interface ArticleSummary {
  id: string;
  title: string;
  reviewInterval: number;
  nextReviewDate: string | null;
  sentenceCount: number;
  savedAsDeck?: boolean;
  savedSentenceIndices?: number[];
  savedSentenceReview?: { reviewInterval: number; nextReviewDate: string | null };
  subDeckReviews?: SubDeckReview[];
  splitPoints?: number[];
  source?: string;
  createdAt: string;
  lastAccessed: string;
}

// Google Sheets 설정
export interface GoogleSheetsConfig {
  spreadsheetId: string;
  range: string; // 예: 'Sheet1!A:E'
  hasHeader: boolean; // 첫 번째 행이 헤더인지 여부
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
