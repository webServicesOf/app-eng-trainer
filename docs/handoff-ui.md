# Handoff: UI 전면 통일 (고급 앱 포장)

> 상태: 착수 전. 기능 코드와 독립적이라 언제든 시작 가능. 리스크 낮음.

## 현 상태 진단 (2026-07 기준)

- MUI 사용 중이나 `createTheme` / `ThemeProvider` **없음** — 전부 기본 테마.
- inline `sx` 250여 개가 5개 스크린에 흩어짐 (HomeScreen 136, TimestampEditor 41, SentenceLearning 36, AudioLearning 32, SavedSentences 7).
- `size="small"`, `sx={{ p: 0.3 }}` 등 동일 값이 화면마다 반복.

## 작업 순서

### 1. `src/theme.ts` 생성 — 이게 80%

```ts
createTheme({
  palette: { ... },        // 브랜드 컬러 2–3개 + neutral 스케일
  typography: { ... },     // 폰트 (Pretendard/Inter) + 크기 스케일 축소
  shape: { borderRadius },  // radius 통일 (10–12px 권장)
  components: { ... },     // ← 핵심, 아래 2번
})
```

`App.tsx`에서 `<ThemeProvider theme={theme}><CssBaseline />` 래핑. 화면 코드 무수정으로 전역 반영.

### 2. `components` 키로 컴포넌트 기본값 강제

- `MuiButton: { defaultProps: { size: 'small', disableElevation: true }, styleOverrides: {...} }`
- 반복 사용 컴포넌트 전부: Chip, IconButton, Paper, Dialog, List/ListItem, TextField.
- 화면마다 반복되는 `size="small"` / `p: 0.3` 류가 여기로 흡수됨.

### 3. 화면별 sweep (테마 적용 후, 화면당 커밋 1개)

- 테마와 중복/충돌하는 로컬 `sx` 제거. 남기는 sx는 레이아웃(flex/gap/grid)만.
- 공용 컴포넌트 추출은 2–3개만: 화면 헤더 Paper, 리스트 행+액션버튼 묶음. 그 이상 추상화 금지.

## "고급" 체감 포인트 (전부 테마에서 제어)

- 폰트: Pretendard 하나 제대로 + 타이포 스케일 축소 (MUI 기본은 큼직해서 촌스러움)
- radius 통일, 그림자 약하게, 보더는 `divider` 색으로 통일
- 간격 4/8px 그리드 준수
- 다크모드: `palette.mode` 토글 — 테마 구조 잡히면 공짜
- transition은 MUI 기본 유지 (과하면 역효과)

## 착수 시

참고할 앱/스크린샷 하나 정해서 시작하면 theme.ts + component overrides를 한 번에 작성 가능.
① theme.ts + ThemeProvider 커밋 → ② 화면별 sweep 커밋 순서.
