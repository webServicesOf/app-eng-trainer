# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

English shadowing trainer. Users upload MP3 + sentences.json (from yt2mp3 pipeline), study with word-level audio seek, review via spaced repetition. Google Drive is SSOT for all article data. Optional YouTube real-time sync for articles with source URLs.

## Development Commands

```bash
npm install
npm start          # http://localhost:3000
npm test
npm run build
```

## Core Architecture

### State Management
- **Zustand stores** in `src/stores/appStore.ts`:
  - `useAppStore`: Global state — audioArticles, subDecks, OAuth, dirty tracking, Drive sync
  - `useLearningStore`: Learning screen state — currentIndex, isCumulative, windowSize

### Data Layer
- **Google Drive (SSOT)**: `eng-trainer/data/` folder
  - `{id}.json` — article metadata + sentences (AudioArticleMeta format)
  - `{id}.mp3` — full audio file
  - `index.json` — manifest for lazy loading (ArticleSummary[])
- **IndexedDB** (`src/services/database.ts`): MP3 cache only + legacy text articles
- **Dirty tracking**: `snapshotArticle()` compares mutable fields. Save button (💾) syncs dirty articles to Drive

### Data Flow
1. `yt2mp3.sh` downloads YouTube → MP3 + WhisperX → `sentences.json` (with source URL)
2. User uploads MP3 + JSON via app → `saveAudioArticle()` → Drive JSON + MP3
3. App load: `loadIndex()` → lightweight article list. Individual JSON loaded on-demand via `loadFullArticle()`
4. Learning: `audioSeekService` plays MP3 segments with word-level tracking
5. Changes (hidden, review interval, etc.) → dirty mark → explicit Save → Drive sync + index update

### Key Services

**GoogleDriveService** (`src/services/googleDriveService.ts`):
- Folder layout: `eng-trainer/data/` (articles) + `eng-trainer/sys/` (settings)
- CRUD: `listArticles()`, `getArticle()`, `saveArticle()`, `deleteArticle()`
- Index: `loadIndex()`, `updateIndex()`, `syncIndex()`, `rebuildIndex()` (self-healing)
- Write guard: `saveDirtyArticles` skips articles with `sentences.length === 0` (lazy-loaded summary)

**audioSeekService** (`src/services/audioSeekService.ts`):
- WebAudio API (`AudioContext` + `AudioBufferSourceNode`)
- `playSentence()`, `playSegments()` — sentence/word-level seek with callbacks
- Word tracking via `requestAnimationFrame` polling against word timestamps
- Playback rate control via `playbackRate` property

**GoogleCloudTTSService** (`src/services/googleCloudTtsService.ts`):
- Text-to-speech for text-based articles (legacy flow)

**GoogleSheetsService** (`src/services/googleSheetsService.ts`):
- Fetches text articles from Google Sheets (legacy flow)

### Routing
- `/` — HomeScreen (deck list, upload, review management)
- `/learn/:id` — SentenceLearningScreen (text-based, legacy)
- `/learn-audio/:id` — AudioLearningScreen (audio seek + word highlight)
- `/edit-timestamps/:id` — TimestampEditorScreen (sentence boundary editor)
- `/saved` — SavedSentencesScreen

## Important Implementation Details

### AudioLearningScreen
- `loadArticle()`: reads store → waits for articles if not loaded → on-demand `loadFullArticle()` → MP3 cache/download
- Sentence display: word-level color/bold tracking synced to audio position
- Blind mode: blurs all words except active word during playback
- Hide toggle: `hidden: true/false` on sentence → dirty mark → Save syncs to Drive
- Hidden list dialog: view/unhide hidden sentences

### YouTube Integration
- Toggle button replaces header play button (only when `article.source` has YouTube URL)
- `react-youtube` IFrame embed above sentence text
- 100ms polling: `player.getCurrentTime()` → sentence/word highlight sync
- Sentence/word click → `player.seekTo()`. End-time auto-pause via `ytEndTimeRef`
- `handleToggleYouTubeMode()` cleans up audio/polling state on switch

### Lazy Loading (index.json)
- App start: download `index.json` (1 file) instead of N individual JSONs
- Store holds `sentences: []` + `sentenceCount: N` for summary-only articles
- Deck entry triggers `loadFullArticle()` → individual JSON download
- **Critical guard**: `saveDirtyArticles` refuses to write articles with `sentences.length === 0`
- Self-healing: if index missing/corrupt → `rebuildIndex()` scans all JSONs

### Data Types (`src/types/index.ts`)
- `AudioArticle`: id, title, sentences[], source?, sentenceCount?, reviewInterval, nextReviewDate, splitPoints?, subDeckReviews?, savedAsDeck?, savedSentenceIndices?
- `SentenceEntry`: index, text, start?, end?, words? (WordTimestamp[]), memo?, hidden?
- `WordTimestamp`: word, start, end
- `SubDeck`: parentId article range reference with own review schedule
- `ArticleSummary`: lightweight index entry (no sentences, has sentenceCount)
- `Article`: legacy text article from Google Sheets

## Technology Stack
- React 19, TypeScript 4.9, MUI 7
- Zustand 5 for state management
- IndexedDB (Dexie) for MP3 cache
- Google Drive API for data persistence
- Google OAuth 2.0 (@react-oauth/google)
- react-youtube for YouTube IFrame embed
- wavesurfer.js for timestamp editor waveform
- React Router 7
