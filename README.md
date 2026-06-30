# English Shadowing Trainer

YouTube 영상에서 추출한 MP3 + 문장 타임스탬프로 영어 쉐도잉 학습을 하는 React 웹앱.
Google Drive를 SSOT(Single Source of Truth)로 사용하며, `yt2mp3` 로컬 파이프라인으로 학습 데이터를 생성한다.

## Quick Start

```bash
# 1. 의존성 설치
npm install

# 2. Google OAuth 클라이언트 ID 설정
#    Google Cloud Console → OAuth 2.0 클라이언트 ID 생성
#    승인된 JavaScript 원본: http://localhost:3000
cp .env.example .env.local
# REACT_APP_GOOGLE_CLIENT_ID=your-client-id 입력

# 3. 개발 서버 실행
npm start
```

## 주요 기능

- **단어 단위 오디오 Seek**: MP3를 문장/단어 단위로 탐색, 실시간 단어 하이라이트 (WebAudio API)
- **YouTube 실시간 싱크**: source URL이 있는 아티클은 YouTube IFrame 임베드 + 100ms 폴링으로 문장/단어 동기화
- **Blind 모드**: 재생 중 활성 단어만 표시, 나머지 블러 처리
- **Spaced Repetition**: 아티클별 reviewInterval / nextReviewDate 기반 복습 관리
- **Lazy Loading**: `index.json` 매니페스트로 앱 시작 시 1회 다운로드 → 개별 아티클은 on-demand 로드
- **Dirty Tracking**: 변경 사항 자동 감지, 명시적 Save로 Drive 동기화
- **문장 숨기기/저장**: 개별 문장 hidden 토글, 저장 문장 별도 화면
- **타임스탬프 편집기**: wavesurfer.js 파형으로 문장 경계 수정

## yt2mp3 파이프라인

이 앱의 학습 데이터는 별도 로컬 스크립트(`yt2mp3.sh`)로 생성한다 (이 repo에 포함되지 않음).

```
YouTube URL → yt-dlp → MP3 → WhisperX → sentences.json (단어별 타임스탬프)
```

생성된 MP3 + JSON을 앱에서 업로드하면 Google Drive에 저장된다.

## 앱 아키텍처

상세 아키텍처는 [`CLAUDE.md`](./CLAUDE.md) 참조.

- **State**: Zustand 5 (`appStore.ts`) — audioArticles, subDecks, OAuth, dirty tracking
- **Data Layer**: Google Drive (`eng-trainer/data/`) SSOT + IndexedDB MP3 캐시
- **Data Flow**: `index.json` 로드 → on-demand `loadFullArticle()` → 학습 → dirty mark → Save → Drive 동기화

## 프로젝트 구조

```
src/
├── screens/
│   ├── HomeScreen.tsx              # 덱 목록, 업로드, 복습 관리
│   ├── AudioLearningScreen.tsx     # 오디오 학습 (단어 하이라이트 + YouTube 싱크)
│   ├── SentenceLearningScreen.tsx  # 텍스트 기반 학습 (legacy)
│   ├── TimestampEditorScreen.tsx   # wavesurfer 타임스탬프 편집기
│   └── SavedSentencesScreen.tsx    # 저장된 문장 목록
├── services/
│   ├── googleDriveService.ts       # Drive CRUD, index 관리, self-healing rebuild
│   ├── audioSeekService.ts         # WebAudio 재생, 문장/단어 seek, 재생속도
│   ├── database.ts                 # IndexedDB (Dexie) MP3 캐시
│   ├── googleSheetsService.ts      # Google Sheets 연동 (legacy)
│   └── googleCloudTtsService.ts    # Cloud TTS (legacy)
├── stores/
│   └── appStore.ts                 # Zustand: useAppStore, useLearningStore
└── types/
    └── index.ts                    # AudioArticle, SentenceEntry, WordTimestamp 등
```

## 기술 스택

| 범주 | 기술 |
|------|------|
| UI | React 19, TypeScript 4.9, MUI 7 |
| 상태 관리 | Zustand 5 |
| 라우팅 | React Router 7 |
| 데이터 저장 | Google Drive API, IndexedDB (Dexie) |
| 인증 | Google OAuth 2.0 (@react-oauth/google) |
| 오디오 | WebAudio API, wavesurfer.js |
| 영상 | react-youtube |
