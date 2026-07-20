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

export type VariantKey = 'vtt' | 'whisperx';

// SubDeck의 복습 상태 (Drive JSON에 포함, 크로스 디바이스 동기화)
export interface SubDeckReview {
  startIndex: number; // SubDeck 식별 키 (startIndex + endIndex)
  endIndex: number;
  nextReviewDate?: string | null;
  reviewInterval: number;
  lastAccessed?: string;
  saved?: boolean; // 덱 저장 여부 (Drive SSOT)
}

// 트랜스크립트 variant — yt2mp3가 VTT/whisperX 두 소스를 모두 업로드.
// variant 간 커플링 방지: sentence index에 종속되는 모든 편집·학습 상태를 여기 담음.
// 두 variant는 문장 개수/경계가 달라 index 공간이 별개 → 반드시 분리.
export interface TranscriptVariant {
  sentences: SentenceEntry[];
  splitPoints?: number[];
  subDeckReviews?: SubDeckReview[];
  savedAsDeck?: boolean;
  savedSentenceIndices?: number[];
  savedSentenceReview?: { reviewInterval: number; nextReviewDate: string | null };
  lastIndex?: number;
}
export interface TranscriptVariants {
  vtt?: TranscriptVariant;
  whisperx?: TranscriptVariant;
}

// Audio 기반 Article (full mp3 + sentences.json 업로드)
// persistence type — Drive JSON + IndexedDB. kind 필드 없음.
export interface AudioArticle {
  id: string;
  title: string;
  audioBlob?: Blob; // full mp3 (IndexedDB 저장용)
  audioUrl?: string; // blob URL (런타임 전용, 저장 안 함)
  sentences: SentenceEntry[]; // 활성 variant의 working copy (모든 consumer가 읽음)
  variants?: TranscriptVariants; // VTT/whisperX 원본+편집본 (신규 아티클만). 없으면 단일 sentences.
  activeVariant?: VariantKey; // 현재 활성 variant (sentences가 미러링하는 대상)
  splitPoints?: number[]; // sentence indices where splits occur (for SubDeck reconstruction)
  subDeckReviews?: SubDeckReview[]; // SubDeck별 복습 상태 (Drive SSOT)
  savedAsDeck?: boolean; // 전체 덱 저장 여부 (Drive SSOT)
  savedSentenceIndices?: number[]; // 저장된 문장 인덱스 (Drive SSOT)
  savedSentenceReview?: { reviewInterval: number; nextReviewDate: string | null }; // 저장 문장 덱 복습
  source?: string; // YouTube URL 등
  sentenceCount?: number; // index summary count (before full sentences loaded)
  lastIndex?: number; // 마지막 학습 문장 index (resume 위치)
  nextReviewDate: Date | null;
  reviewInterval: number; // days
  createdAt: Date;
  lastAccessed: Date;
}

// ── Store runtime types (CQRS-lite discriminated union) ──────────

// 공유 필드 — summary와 loaded 모두 가지는 메타데이터
export interface ArticleBase {
  id: string;
  title: string;
  reviewInterval: number;
  nextReviewDate: Date | null;
  savedAsDeck?: boolean;
  savedSentenceIndices?: number[];
  savedSentenceReview?: { reviewInterval: number; nextReviewDate: string | null };
  subDeckReviews?: SubDeckReview[];
  splitPoints?: number[];
  source?: string;
  lastIndex?: number; // 마지막 학습 문장 index (resume 위치)
  activeVariant?: VariantKey; // 활성 트랜스크립트 variant (신규 아티클만)
  createdAt: Date;
  lastAccessed: Date;
}

// summary: index.json에서 로드, HomeScreen 카드 렌더용. sentences 필드 없음.
export interface SummaryArticle extends ArticleBase {
  kind: 'summary';
  sentenceCount: number;
}

// loaded: full JSON 로드 완료. sentences 항상 존재.
export interface FullArticle extends ArticleBase {
  kind: 'loaded';
  sentences: SentenceEntry[];
  variants?: TranscriptVariants; // VTT/whisperX 편집본 (신규 아티클만)
  audioBlob?: Blob;
  audioUrl?: string;
}

// Store가 보유하는 article 타입 — 컴파일러가 write 경로 분기 강제
export type StoreArticle = SummaryArticle | FullArticle;

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
  lastIndex?: number; // 마지막 학습 문장 index (resume 위치)
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
