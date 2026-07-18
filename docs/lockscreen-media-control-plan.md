# 잠금화면 미디어키 제어 — 구현 계획

## 0. 문제 정의

잠금(닫힌) 상태에서도 학습 조작 가능하게. 잠금 시 **방향키는 브라우저에 도달하지 않음** — 오직
`navigator.mediaSession` action(미디어키 / 블루투스 헤드셋 버튼 / 잠금화면 위젯 버튼)만 동작. 따라서
"닫힌 모드" = MediaSession 기반. "열린 모드" = 기존 키보드.

핵심 설계: **모드 전환 상태머신 없음.** 키보드 핸들러와 MediaSession 핸들러를 *동시 등록*,
둘 다 동일한 shared handler 호출. 포커스 있으면 키보드 발동, 잠금이면 MediaSession 발동. 미디어
슬롯이 4개뿐이라 닫힌 모드는 자동으로 4기능만 노출.

---

## 1. 요구사항 정리 (현재 → 목표)

### 열린 모드 (키보드, 포커스 시)

| 키 | 현재 | 목표 |
|---|---|---|
| ArrowLeft | 이전 문장 | **이전/처음부터 통합** — 1탭=처음부터 재생, 더블탭=이전 문장 |
| ArrowRight | 다음 문장 | 다음 문장 (유지) |
| ArrowUp | 누적 ON | (해제 — 미사용) |
| ArrowDown | 단일 ON | **누적/단일 토글** (한 키로) |
| Space | 재생/정지 | 유지 |
| `S` (KeyS) | 처음부터 재생 | **저장(현재 문장)** 으로 재바인딩 |
| `Y` (KeyY) | YouTube 토글 | 유지 |

### 닫힌 모드 (MediaSession, 잠금 시) — 미디어키 4개

| MediaSession action | 매핑 |
|---|---|
| `previoustrack` | 이전/처음부터 (1탭=처음부터, 더블탭=이전) |
| `nexttrack` | 다음 문장 |
| `play` / `pause` | 재생/정지 토글 |
| `stop` | **저장(현재 문장)** |

닫힌 모드에서 **누적/단일 토글·전체재생 미제공** (슬롯 부족, 자동 결과).

### 공통 기능
- **전체재생**: UI 버튼 기능으로 구현. YouTube 아티클은 영상 클릭 → YouTube 앱 전체재생.
- **exit resume**: 앱 백그라운드/종료 시 현재 문장 index를 Drive에 저장 → 재오픈 시 그 문장부터.

---

## 2. 핵심 기술 제약 (⚠️ 게이팅 이슈)

**iOS 잠금화면 + Web Audio API 문제.** 현재 오디오는 `AudioContext` +
`AudioBufferSourceNode`(Web Audio). iOS Safari는 잠금화면 미디어 컨트롤을 **HTMLMediaElement
재생에만** 표시 — 순수 Web Audio에는 잠금화면 위젯이 뜨지 않음. Android Chrome도 미디어
element/positionState 없으면 불안정.

→ **해법(제안): 무음 앵커 오디오.** 세션 활성 시 루프되는 무음 `<audio>` element를 재생해
미디어 세션을 "점유"하고, 실제 소리는 기존 Web Audio가 담당. MediaSession action 핸들러는
Web Audio를 조작. 잠금화면 위젯/메타데이터는 무음 앵커가 유지.
(대안: 세그먼트 재생을 HTMLAudioElement로 이관 — 대규모 리팩터, 단어 타이밍 재검증 필요. 비추천.)

**이 제약이 전체 기능 성립 여부를 결정.** 타깃 기기(iPhone/Android) 실측 필요.

---

## 3. 스키마 변경

`src/types/index.ts`:

```
ArticleBase   + lastIndex?: number   // 마지막 학습 문장 index (resume)
AudioArticle  + lastIndex?: number   // Drive JSON 영속 타입
ArticleSummary+ lastIndex?: number   // index.json 매니페스트 (선택)
```

- `SentenceEntry` 변경 없음 (저장은 IndexedDB `SavedSentence`로 별도 유지).
- `snapshotArticle()` dirty diff에 `lastIndex` 포함 → 기존 Save 경로로 영속.
- lazy-load 가드 영향 없음: exit 시 저장 대상은 항상 로드된 FullArticle.

---

## 4. exit resume 저장 흐름

- 로드: `setCurrentIndex(article.lastIndex ?? 1)` (URL param 우선순위는 유지).
- 저장 트리거: `visibilitychange` → `hidden` (모바일 백그라운드 신뢰성 높음). `pagehide` 보조.
- 저장 수단: 현재 아티클 JSON에 `lastIndex` 갱신 → Drive PATCH. `beforeunload`는 async 불가
  → fetch `keepalive: true` 사용. 실패 대비 index 변경마다 debounce(5s) 저장 병행 (하드킬 시 손실 ≤5s).

⚠️ 위험: Drive 저장은 async + OAuth 헤더 필요. `keepalive` fetch가 gapi 클라이언트에서 되는지
확인 필요. 안 되면 debounce 주기 저장이 주 경로.

---

## 5. 구현 단계 — 실제 순서 2→3→4→5 (0 흡수)

Phase 0(별도 PoC) 삭제: Phase 3 실물이 곧 실측. throwaway 안 만듦.

**Phase 1 — 스키마. ✅ 완료.** `lastIndex?: number` — `types/index.ts`(3곳), `googleDriveService`
(Meta+articleToMeta/metaToArticle/articleToSummary), `appStore`(snapshot dirty, toIndexSummary,
summary/rebuild/loadFull 매퍼). 신규 액션 `setLastIndex`.

**Phase 2 — 키보드 재배치. ✅ 완료.** ↓=`handleToggleCumulative`, ←=`handleLeftAction`
(1탭 즉시 PlayFromStart / 350ms 내 2탭 Prev), `S`→`handleSaveSentence`(useCallback화), ArrowUp
해제, Y 유지. 화면 버튼(up/down/left/play-from-start)은 개별 유지.

**Phase 3 — MediaSession. ✅ 코드 완료 / ⚠️ Android 실측 대기.**
`services/mediaSession.ts`(무음 WAV 런타임 생성 앵커 + prev/next/play/pause/stop→shared handler +
playbackState). 화면에 3 effect(등록/상태동기화/unmount 정리). **ponytail ceiling**: 무음 앵커가
Android 알림 실제로 띄우는지 미검증 — 안 뜨면 극저볼륨 tone 또는 실제 mp3 element 앵커로 교체.

**Phase 4 — exit resume. ✅ 완료.** 로드 시 `lastIndex` 복원(plain/명시 sentence만),
visibilitychange(hidden)+pagehide 시 `setLastIndex`+`saveDirtyArticles`. remap 모드(저장덱/subdeck)
제외(`plainOpenRef`). 하드킬 대비 주기저장 미구현(best effort).

**Phase 5 — 전체재생 제거 (재고 후 철회).** 전체재생 기능은 존재 이유 없음 → 삭제.
문장 단위 재생만 유지하고 거기서 currentIndex가 네비 따라 움직이므로 resume는 이미 성립.
헤더에는 **YouTube 앱 열기 버튼(`OpenInNew`)만** easy-access용으로 남김(YouTube 아티클 한정,
`handleOpenYouTubeApp`, 첫 문장 start deep link). MP3 인앱 전체재생 제거.

---

## 6. 결정 사항 (확정)

1. **타깃 = Android.** BT 키보드 미디어키로 잠금화면 조작. 무음 앵커는 유지(활성 세션 필요).
2. **stop = 저장 확정.** 미디어키 4개(prev/next/play-pause/stop) 중 stop을 저장으로 재해석.
   - 명시: prev/next 미디어키는 "이전곡/다음곡"이 아니라 **문장 단위 이동**. `previoustrack`/
     `nexttrack` 핸들러가 문장 이동 함수 호출. "곡=문장" 매핑은 앱 정책, 기술 무리 없음.
3. **더블탭 = BT 키보드 미디어키만.** 헤드셋 감지 불필요. BT 키보드는 discrete 이벤트 전달 →
   OS 자체소비 없음, ~350ms 창 더블탭 안전.
   - 전제: 잠금 시 방향키는 어느 앱도 못 받음 → 미디어키만 활성 세션으로 라우팅. 따라서
     무음 앵커로 세션 활성 유지가 미디어키 수신의 필수 조건.
