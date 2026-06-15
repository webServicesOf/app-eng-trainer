# Handoff: eng-trainer 다음 세션

## 완료된 작업 (2026-06-12~14 세션)

### 아키텍처 변경
- **Drive = SSOT** 리팩토링 완료. sync 레이어 제거
  - Audio articles: Google Drive 직접 CRUD
  - Text articles: Google Sheets SSOT (변경 없음)
  - IndexedDB: MP3 blob 캐시 전용
  - SubDecks: splitPoints에서 파생 (IndexedDB 로컬)
- **Drive 폴더 구조**: `eng-trainer/data/` + `eng-trainer/sys/` 분리 + 자동 마이그레이션
- **SubDeck SSOT**: Drive JSON의 `splitPoints` + `subDeckReviews` 기반 재생성 (크로스 디바이스 동기화)
- **dirty state 패턴**: 복습/간격 버튼 → 로컬 즉시 반영 → "저장" 버튼으로 일괄 Drive 저장
- settings.json → Drive sys/ 동기화

### 기능
- 복습 시스템: 고정 간격 [0,1,3,7,10,30,120일] + Sheets 역방향 싱크
- SubDeck: TimestampEditor에서 분할점 지정 (D키 = 문장 분할, ⌘D = 덱 분할점)
- SubDeck에 최근접근/복습일 표시
- 단어 단위 하이라이트 (Whisper words → 실제 timestamps, fallback = 선형 보간)
- 문장 탭 → 해당 문장부터 재생
- ▶/⏸ 토글 + ↺ 처음부터 재생 + 화살표 이동 시 자동재생
- 블라인드 모드: 눈 아이콘 ON 시만 블러, OFF 시 문장 보이며 현재 단어만 bold
- YouTube URL 변환 UI (Cloud Run 연동 준비 완료)
- 설정 통합 다이얼로그 / 타이틀 인라인 편집 / Redo / E키

### 인프라
- Cloud Run 배포 완료: `https://yt2csv-api-170425201554.asia-northeast3.run.app`
  - health check OK
  - yt-dlp는 서버 IP에서 YouTube bot detection으로 **사용 불가** (알려진 문제)
  - Whisper (small.en) + ffmpeg는 정상 동작
- Vercel 환경변수: `REACT_APP_YT_CONVERT_URL` 등록 완료
- env 관리: `.env.development` (로컬) + `.env.production` (Vercel SSOT) + `scripts/sync-env.sh`

### 미해결
- wavesurfer pause 시 커서 점프 (포기 — 라이브러리 내부 + React re-render 충돌)

## 다음 세션 작업: 파이프라인 재설계

### 확정된 구조

```
[메인 학습 흐름]
로컬: yt2mp3 <url> → _full.mp3 추출 (yt-dlp, 로컬 only)
  → 앱: MP3 업로드 버튼 → Drive 저장
  → 앱: 자동으로 Cloud Run Whisper 호출
  → Cloud Run: POST /transcribe (MP3 → sentences + words 동시 생성)
  → 결과 Drive JSON에 저장
  → 앱: Timestamp Editor에서 미세 조정
  → 앱: 누적 쉐도잉 학습 (단어 하이라이트)

[Anki Export — 후순위]
앱: Saved 문장 → "Export"
  → Cloud Run: ffmpeg로 해당 구간 clip + 텍스트
  → zip 다운로드 (또는 Drive 저장)
  → Anki: Front=문장+음성, Back=소스
  → 열구조(패턴/카테고리)는 나중에 lecture2csv 연동으로
```

### 구현 단계

1. **yt2csv → yt2mp3 rename**
   - `90System/Snippets/Scripts-Global/yt2csv.sh` → `yt2mp3.sh`
   - MP3 추출 + _INDEX.md 만 유지, VTT/dedup/clips/import.tsv 제거
   - symlink `~/.local/bin/yt2mp3` 생성

2. **Cloud Run API 변경**
   - 기존 `POST /convert` (yt-dlp 포함) → 제거
   - 신규 `POST /transcribe` — body: MP3 binary, response: sentences + words JSON
   - Whisper small.en 모델로 문장+단어 동시 생성
   - VTT dedup 로직 제거 (Whisper가 전부 담당)

3. **앱 UI 변경**
   - Audio 탭 업로드 버튼: MP3 선택 → Drive 저장 → Cloud Run `/transcribe` 자동 호출 → 결과 Drive JSON 업데이트
   - YouTube URL 입력 UI 제거 (또는 "로컬에서 yt2mp3 사용" 안내로 변경)
   - `ytConvertService.ts` → `whisperService.ts`로 변경

4. **(후순위) Anki Export**
   - Saved 탭에 "Export" 버튼
   - Cloud Run `POST /clip` — MP3 + timestamps → clip zip 반환
   - 앱에서 zip 다운로드

### 고려사항
- Cloud Run 무료 tier 충분 (Whisper만 → yt-dlp 없으니 이미지도 작아짐)
- yt-dlp 관련 코드 (dedup.py, cookies, EJS solver) Cloud Run에서 제거 가능
- Docker 이미지: python + ffmpeg + whisper만 → ~800MB (현재 ~1.5GB에서 축소)

### 관련 파일
- Blueprint: `01 Command Center/proj-EnglishIdentityTrainer/021Trainner-Accumulative/docs-Blueprint.md`
- Cloud Run 가이드: `01 Command Center/proj-EnglishIdentityTrainer/001YoutubeLecture2DB/docs/bit-GCP-cloudRun.md`
- yt2csv 원본: `90System/Snippets/Scripts-Global/yt2csv.sh`
- dedup: `90System/Snippets/Scripts-Global/yt2csv_dedup.py`
- 앱 레포: `~/GIT/app-eng-trainer`
- Cloud Run: `~/GIT/app-eng-trainer/cloud-run/`
- J2S: `90System/Claude/junior-to-senior/2026-06-13-eng-trainer-cloud-run-drive-sync.md`

### 현재 앱 구조 (참고)
```
src/
├── services/
│   ├── googleDriveService.ts  ← Drive CRUD (SSOT, data/ + sys/ 분리)
│   ├── googleSheetsService.ts ← Sheets CRUD (Text SSOT)
│   ├── database.ts            ← IndexedDB (MP3 캐시 + SubDecks)
│   ├── audioSeekService.ts    ← HTML5 Audio seek + word tracking
│   ├── googleCloudTtsService.ts ← TTS
│   └── ytConvertService.ts    ← Cloud Run 호출 (→ whisperService.ts로 변경 예정)
├── stores/appStore.ts         ← Zustand (Drive-backed audio + dirty state)
├── screens/
│   ├── HomeScreen.tsx         ← 탭 (Text/Audio/Saved) + 저장 버튼
│   ├── AudioLearningScreen.tsx ← 단어 하이라이트 + 문장 탭 재생
│   ├── SentenceLearningScreen.tsx
│   └── TimestampEditorScreen.tsx
├── types/index.ts             ← WordTimestamp, SubDeckReview 추가됨
└── cloud-run/
    ├── main.py                ← FastAPI (→ /transcribe로 변경 예정)
    ├── word_align.py          ← Whisper alignment
    ├── dedup.py               ← VTT dedup (제거 예정)
    └── Dockerfile
```

## 다음 세션 시작 멘트

> "eng-trainer 이어서. HANDOFF.md 참고. 파이프라인 재설계 1번(yt2mp3 rename)부터."
