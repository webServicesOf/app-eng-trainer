# Architecture — eng-trainer

English shadowing trainer. Upload MP3 + sentences.json (from yt2mp3 pipeline), study with word-level audio seek, review via spaced repetition. Google Drive is SSOT.

## Tech Stack

- React 19 + TypeScript 4.9 (CRA / react-scripts)
- MUI 7 (Material UI)
- Zustand 5 (state management)
- Dexie (IndexedDB — MP3 cache)
- Google Drive API (persistence SSOT)
- Google OAuth 2.0 (@react-oauth/google)
- react-youtube (YouTube IFrame embed)
- wavesurfer.js (timestamp editor waveform)
- React Router 7
- Deployed on Vercel

## Directory Structure

```
src/
├── App.tsx                  # Routes, theme, GoogleOAuthProvider wrapper
├── components/
│   ├── GlobalAuthManager.tsx  # OAuth token lifecycle
│   └── ReAuthDialog.tsx       # Re-auth prompt on token expiry
├── screens/
│   ├── HomeScreen.tsx           # Deck list, upload, review management
│   ├── AudioLearningScreen.tsx  # Main study screen: audio seek + word highlight + YouTube sync
│   ├── SentenceLearningScreen.tsx # Text-based study (legacy, Google Sheets flow)
│   ├── TimestampEditorScreen.tsx  # Sentence boundary editor (wavesurfer)
│   └── SavedSentencesScreen.tsx   # Saved sentences deck
├── stores/
│   └── appStore.ts            # Zustand: useAppStore + useLearningStore
├── services/
│   ├── googleDriveService.ts    # Drive CRUD, index.json manifest, folder layout
│   ├── audioSeekService.ts      # WebAudio API: sentence/word-level playback
│   ├── database.ts              # Dexie IndexedDB (MP3 cache + legacy text articles)
│   ├── googleCloudTtsService.ts # TTS (legacy)
│   └── googleSheetsService.ts   # Sheets fetch (legacy)
└── types/
    └── index.ts               # All type definitions
scripts/
├── sync-env.sh
└── vercel-setup.sh
```

## Routes

| Path | Screen | Purpose |
|------|--------|---------|
| `/` | HomeScreen | Deck list, upload, review management |
| `/learn-audio/:id` | AudioLearningScreen | Audio seek + word highlight (primary) |
| `/learn/:id` | SentenceLearningScreen | Text-based learning (legacy) |
| `/edit-timestamps/:id` | TimestampEditorScreen | Sentence boundary editor |
| `/saved` | SavedSentencesScreen | Saved sentences review |

## Data Flow

```
[Offline pipeline]
  YouTube → yt2mp3.sh → MP3 + WhisperX → sentences.json (with source URL)

[Upload]
  User uploads MP3 + JSON → saveAudioArticle() → Drive JSON + Drive MP3

[App load]
  loadIndex() → index.json (ArticleSummary[]) → SummaryArticle[] in store
  User opens article → loadFullArticle(id) → Drive JSON → FullArticle in store
                                             → IndexedDB MP3 cache hit or Drive MP3 download

[Study]
  audioSeekService plays MP3 segments with word-level tracking (requestAnimationFrame)
  OR YouTube mode: react-youtube IFrame + 100ms polling for sentence/word sync

[Save]
  User edits (hidden, review interval, memo, etc.) → dirty mark in store
  Explicit Save button → saveDirtyArticles() → Drive JSON + index.json update
```

## Key Types (CQRS-lite Discriminated Union)

```
StoreArticle = SummaryArticle | FullArticle

SummaryArticle (kind:'summary')
  ArticleBase + sentenceCount
  NO sentences field → compiler blocks accidental Drive write

FullArticle (kind:'loaded')
  ArticleBase + sentences[] + audioBlob?
  Safe to write to Drive

AudioArticle — persistence type (Drive JSON + IndexedDB). No kind field.
  Used only at Drive I/O boundary.

SentenceEntry: { index, text, start?, end?, words?: WordTimestamp[], memo?, hidden? }
WordTimestamp: { word, start, end }

SubDeck: article sentence range reference with own review schedule
SubDeckReview: { startIndex, endIndex, reviewInterval, nextReviewDate, ... }
ArticleSummary: index.json serialization type (string dates)
```

**Write guard**: `drive.saveArticle()` throws on empty sentences (최후 방어). `saveDirtyArticles` skips SummaryArticle (sentences.length === 0).

## State Management

Single file: `src/stores/appStore.ts`

**useAppStore** (global):
- `audioArticles: StoreArticle[]` — discriminated union array
- `subDecks: SubDeck[]`
- OAuth state: `accessToken`, `isAuthenticated`, `needsReAuth`
- Dirty tracking: `dirtyAudioIds: Set<string>`, `pendingDeleteIds: Set<string>`
- Clean snapshots: `cleanAudioIntervals: Map<string, number>` for dirty comparison via `snapshotArticle()`
- Actions: `loadAudioArticles`, `loadFullArticle`, `saveAudioArticle`, `saveDirtyArticles`, `markReviewDone`, `cycleReviewInterval`, etc.

**useLearningStore** (screen-local):
- `currentIndex`, `isCumulative`, `windowSize`

## External Dependencies & Integrations

**Google Drive** (SSOT):
- Folder: `eng-trainer/data/` — `{id}.json` (article meta + sentences), `{id}.mp3` (audio)
- Folder: `eng-trainer/sys/` — settings
- `index.json` — manifest for lazy loading (self-healing via `rebuildIndex()`)

**Google OAuth 2.0**:
- Client ID via `REACT_APP_GOOGLE_CLIENT_ID` env var
- `GlobalAuthManager` handles token lifecycle, `ReAuthDialog` handles expiry

**IndexedDB** (Dexie):
- MP3 blob cache (avoids re-downloading from Drive)
- Legacy text articles (Google Sheets flow)

**Vercel**:
- Deployment target
- Env files: `.env`, `.env.development`, `.env.production`
- `CI=true` → warnings are build failures (clean unused imports before commit)

**YouTube** (optional per-article):
- Articles with `source` URL get YouTube toggle in AudioLearningScreen
- `react-youtube` IFrame + 100ms `player.getCurrentTime()` polling for sync

## AudioLearningScreen Behavior

Primary study screen (`/learn-audio/:id`). Plays MP3 (WebAudio) or YouTube IFrame with word-level highlight synced to playback.

**Playback**: 문장 단위 (단일: 현재 1문장 / 누적: 윈도우 연속). 전체재생 없음(의도적 제거).

**Keyboard** (letter 키는 `e.code`):
- `↓` 누적/단일 토글 · `←` 1탭 처음부터 / 더블탭(350ms) 이전 · `→` 다음 · `Space` 재생/정지
- `S`(KeyS) 문장 저장 · `Y`(KeyY) YouTube/MP3 토글 · `↑` 미사용

**Progress bar**: 클릭 → 해당 위치 문장으로 이동 (`handleProgressJump`: 재생 정지 + 커서 이동, 숨김 문장은 가장 가까운 표시 문장으로, YouTube 모드는 영상 seek + pause).

**Resume & edit persistence** — 두 종류를 분리 (`plainOpenRef`로 remap 모드=저장덱/subdeck 제외):
- *자동 편집* (current index → `lastIndex`): **dirty/Save 버튼과 무관** (`snapshotArticle`에서 제외). 홈이동/아티클전환/언마운트 시 `persistLastIndex`가 `index.json`에 이 아티클 `lastIndex`만 surgical write(조용히, 경고 없음). 앱 종료/백그라운드는 `visibilitychange(hidden)`/`pagehide` best-effort (하드 종료 시 async 미완 가능).
- *의도적 편집* (hidden, save): dirty 추적 → **Save 버튼으로만** Drive 반영. 저장 안 하고 홈 이동 시 경고 다이얼로그 → 확정 시 `discardArticleEdits`(dirty 즉시 해제 + Drive 재로드로 in-memory 편집 되돌림, 커서는 유지). 앱 종료 시 `beforeunload` 네이티브 경고.

**Blind mode**: 재생 중 active word 외 모든 단어 blur.

**Hide toggle**: `hidden: true/false` on sentence → dirty → Save로 Drive 반영. Hidden list dialog로 view/unhide.

**MediaSession** (`services/mediaSession.ts`): 잠금화면 미디어키 → 키보드와 동일 shared handler. 무음 `<audio>` 앵커로 세션 점유(Web Audio 단독은 잠금 위젯 안 뜸). ⚠️ Android 실측 미완.

**YouTube** (article `source`에 URL 있을 때만): 헤더 toggle 버튼 · `react-youtube` IFrame · 100ms `getCurrentTime()` polling으로 문장/단어 sync · 문장/단어 클릭 `seekTo` · 헤더 OpenInNew로 외부 YouTube 앱 deep link (첫 문장 start 지점).

## Safety Notes for Modification

- 함수 수정 시: 모든 분기(YouTube/Audio, loaded/summary) 전수 검사
- `StoreArticle` discriminated union: kind 체크 없이 sentences 접근하면 컴파일 에러 (의도됨)
- Dirty tracking: 수정 후 `snapshotArticle()` 비교 로직 확인
- Drive write guard: sentences 비어있으면 throw — summary 상태에서 저장 시도 방지
- wavesurfer: backend 'WebAudio' 필수 (MediaElement은 seek 부정확)
- 키보드 단축키: `e.code` 사용 (한글 IME에서 `e.key` 실패)
- 커밋 전 unused import 제거 (Vercel CI=true)

---

이 앱 수정 시 vault의 proj-EnglishIdentityTrainer/ docs도 참조할 것 (taxonomy, blueprint, book/lecture pipeline docs).
