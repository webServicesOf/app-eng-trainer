# 영어 학습 웹 애플리케이션

React로 구현된 Google Sheets 기반 영어 학습 웹 애플리케이션입니다.
## 개발자 팁
### 구현 주소
- https://github.com/webServicesOf/app-eng-trainer/tree/main
- https://vercel.com/thk-lightmans-projects/app-eng-trainer-2
### 개선 방법
- 로컬에서 수정 후 push 하면, 자동으로 앱에 수정사항 반영됨
## 주요 기능

### 1. Google Sheets 연동
- **OAuth 2.0 인증**: Google 계정으로 로그인하여 개인 스프레드시트 접근
- **자동 데이터 동기화**: Google Sheets의 Article 데이터를 로컬 DB에 저장
- **오프라인 지원**: 한 번 불러온 데이터는 IndexedDB에 저장되어 오프라인에서도 사용 가능

### 2. 문장 학습 기능
- **TTS (Text-to-Speech)**: Web Speech API를 활용한 영어 문장 읽기
- **순차적 표시**: 문장을 하나씩 또는 누적하여 표시
- **키보드 네비게이션**:
  - ↑ 누적 표시 (1번 문장부터 현재까지)
  - ↓ 단일 표시 (현재 문장만)
  - ← 이전 문장으로 이동
  - → 다음 문장으로 이동
  - Space TTS 재생

### 3. 로컬 데이터 관리
- **IndexedDB**: 로컬 데이터베이스를 통한 Article 저장
- **학습 기록**: 마지막 접근 시간 자동 업데이트
- **Article 삭제**: 불필요한 Article 삭제 기능

## 설치 및 실행

### 1. 프로젝트 클론 및 의존성 설치
```bash
git clone <repository-url>
cd app-eng-trainer
npm install
```

### 2. Google OAuth 2.0 클라이언트 ID 설정

#### 2-1. Google Cloud Console에서 OAuth 클라이언트 ID 생성

1. [Google Cloud Console](https://console.cloud.google.com/)에 접속
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. **Google Sheets API 활성화**
   - [Google Sheets API 라이브러리](https://console.cloud.google.com/apis/library/sheets.googleapis.com)로 이동
   - "사용 설정" 버튼 클릭
4. **OAuth 동의 화면 설정**
   - "APIs & Services" > "OAuth 동의 화면" 이동
   - User Type: "외부" 선택
   - 앱 정보 입력 (앱 이름, 사용자 지원 이메일 등)
   - 범위 추가: `https://www.googleapis.com/auth/spreadsheets.readonly`
5. **OAuth 2.0 클라이언트 ID 생성**
   - [사용자 인증 정보 페이지](https://console.cloud.google.com/apis/credentials)로 이동
   - "사용자 인증 정보 만들기" > "OAuth 클라이언트 ID" 선택
   - 애플리케이션 유형: "웹 애플리케이션"
   - 승인된 JavaScript 원본: `http://localhost:3000`
   - 승인된 리디렉션 URI: `http://localhost:3000`
   - "만들기" 클릭 후 클라이언트 ID 복사

#### 2-2. 환경 변수 설정

1. `.env.example` 파일을 복사하여 `.env` 파일 생성:
   ```bash
   cp .env.example .env
   ```

2. `.env` 파일을 열고 클라이언트 ID 입력:
   ```
   REACT_APP_GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
   ```

### 3. 개발 서버 실행
```bash
npm start
```
브라우저에서 `http://localhost:3000`으로 접속

## 사용 방법

### 1. Google Sheets 준비

스프레드시트에 다음과 같은 형식으로 데이터를 입력하세요:

| Title | Content |
|-------|---------|
| Article 1 | This is the first sentence. This is the second sentence. |
| Article 2 | Learning English is fun. Practice makes perfect. |

- **A열**: Article 제목
- **B열**: 영어 문장 (마침표로 문장 구분)

### 2. 애플리케이션 사용

#### 2-1. Google 로그인
1. 홈 화면에서 "Google 로그인" 버튼 클릭
2. Google 계정 선택 및 권한 승인
3. 로그인 성공 시 "로그인됨" 상태 표시

#### 2-2. Google Sheets 설정
1. 홈 화면 우상단 톱니바퀴(⚙️) 아이콘 클릭
2. **Spreadsheet ID** 입력:
   - Google Sheets URL에서 복사: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`
   - 예: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`
3. **Range** 입력 (기본값: `Sheet1!A:B`)
4. "저장" 버튼 클릭

#### 2-3. Article 불러오기
1. 홈 화면에서 "불러오기" 버튼 클릭
2. Google Sheets에서 Article 데이터를 가져와 로컬 DB에 저장
3. Article 카드가 화면에 표시됨

#### 2-4. 학습하기
1. Article 카드에서 "학습하기" 버튼 클릭
2. 문장 학습 화면에서:
   - **스피커 아이콘(🔊)** 또는 **Space 키**: TTS 재생
   - **↑ 키**: 누적 표시 모드 (1번 문장부터 현재까지)
   - **↓ 키**: 단일 표시 모드 (현재 문장만)
   - **← 키**: 이전 문장
   - **→ 키**: 다음 문장
   - **Home 아이콘**: 홈으로 돌아가기

## 기술 스택

- **Frontend**: React 19, TypeScript
- **UI 라이브러리**: Material-UI (MUI) v7
- **상태 관리**: Zustand
- **로컬 데이터베이스**: Dexie (IndexedDB)
- **라우팅**: React Router
- **HTTP 클라이언트**: Axios
- **OAuth**: @react-oauth/google
- **TTS**: Web Speech API

## 프로젝트 구조

```
src/
├── screens/           # 화면 컴포넌트
│   ├── HomeScreen.tsx              # 홈 화면 (OAuth 로그인, Article 목록)
│   └── SentenceLearningScreen.tsx  # 문장 학습 스크린 (TTS, 키보드 네비게이션)
├── services/          # 비즈니스 로직 서비스
│   ├── database.ts                 # IndexedDB 서비스 (Dexie)
│   ├── googleSheetsService.ts      # Google Sheets API 서비스
│   └── ttsService.ts               # TTS 서비스
├── stores/            # 상태 관리
│   └── appStore.ts                 # 전역 상태 (Article, OAuth, Config)
├── types/             # TypeScript 타입 정의
│   └── index.ts                    # 인터페이스 정의
└── App.tsx            # 메인 앱 컴포넌트 (OAuth Provider)
```

## 주요 인터페이스

### 데이터 모델
- `Article`: Article 데이터 (id, title, content, sentences, 타임스탬프)
- `SentenceEntry`: 문장 엔트리 (index, text, memo)
- `GoogleSheetsConfig`: Sheets 설정 (spreadsheetId, range)
- `AuthState`: OAuth 인증 상태 (accessToken, isAuthenticated)

### 서비스 클래스
- `GoogleSheetsService`: Google Sheets API 연동 (OAuth 토큰 사용)
- `LocalDatabaseService`: IndexedDB 관리 (Article, OAuth 토큰, Sheets 설정)
- `TTSService`: Web Speech API 래퍼 (영어 음성 읽기)

## 오프라인 지원

이 애플리케이션은 오프라인에서도 사용할 수 있습니다:
- Article 데이터는 IndexedDB에 로컬 저장
- Google Sheets 불러오기는 온라인 필요
- 한 번 불러온 Article은 오프라인에서도 학습 가능
- TTS는 브라우저 내장 기능으로 오프라인 지원

## 브라우저 호환성

- **Chrome 80+** (권장)
- **Edge 80+**
- **Safari 13+**
- **Firefox 78+**

*TTS는 브라우저별로 음성이 다를 수 있습니다.*

## 문제 해결

### OAuth 로그인 오류
- Google Cloud Console에서 OAuth 클라이언트 ID가 올바르게 설정되었는지 확인
- 승인된 JavaScript 원본과 리디렉션 URI에 `http://localhost:3000`이 추가되었는지 확인
- `.env` 파일에 `REACT_APP_GOOGLE_CLIENT_ID`가 설정되었는지 확인

### Google Sheets 데이터를 불러올 수 없음
- Google 로그인이 되어 있는지 확인 ("로그인됨" 표시 확인)
- Spreadsheet ID가 정확한지 확인
- Google Cloud Console에서 Google Sheets API가 활성화되었는지 확인
- OAuth 범위에 `https://www.googleapis.com/auth/spreadsheets.readonly`가 포함되었는지 확인

### TTS가 작동하지 않음
- 브라우저가 Web Speech API를 지원하는지 확인 (Chrome 권장)
- 시스템 볼륨이 음소거 상태가 아닌지 확인
- 다른 브라우저에서 시도해보기

### 데이터가 표시되지 않음
- 브라우저 개발자 도구 (F12) → Console에서 에러 확인
- IndexedDB가 활성화되어 있는지 확인
- 브라우저 캐시 및 로컬 스토리지 초기화 후 재시도

## 라이센스

MIT License
