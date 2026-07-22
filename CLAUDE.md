# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repo.

**Keep this file lean.** Architecture and implementation details live in `docs/ARCHITECTURE.md`, the type schema, and the source. Reference them here — do not duplicate detail that drifts out of date.

## Project Overview

English shadowing trainer. Users upload MP3 + sentences.json (from yt2mp3 pipeline), study with word-level audio seek, review via spaced repetition. Google Drive is SSOT for all article data. Optional YouTube real-time sync for articles with source URLs.

## Development Commands

```bash
npm install
npm start          # http://localhost:3000
npm test
npm run build
```

## Where Things Live

| Topic | Source |
|-------|--------|
| Architecture, data flow, routes, integrations, tech stack | `docs/ARCHITECTURE.md` |
| AudioLearningScreen behavior (playback, resume, keyboard, YouTube, MediaSession) | `docs/ARCHITECTURE.md` → *AudioLearningScreen Behavior* |
| Type schema (`StoreArticle`, `SentenceEntry`, `AudioArticle`, …) | `src/types/index.ts` |
| State, dirty tracking, Drive sync actions | `src/stores/appStore.ts` |
| Drive CRUD + `index.json` manifest | `src/services/googleDriveService.ts` |
| Audio playback (WebAudio seek) | `src/services/audioSeekService.ts` |

## Code Modification Protocol

함수/동작 수정 시 반드시:
1. **편집 전**: 수정 대상 grep → 영향 받는 모든 코드 경로 나열 (분기, 호출처, 모드별 분기)
2. **편집 중**: 함수 내 모든 조건 분기(if/else, switch)에 수정 여부 태그 — "누락" 있으면 미완료
3. **편집 후**: diff 역질문 — "되돌리면 몇 시나리오 깨지나?" 예상보다 적으면 누락 존재
4. **키보드 이벤트**: letter 키는 `e.code` (KeyS, KeyY) 사용 — `e.key`는 한글 IME에서 실패
5. **커밋 전**: unused import 제거 (Vercel `CI=true` → warning이 build 실패)
