# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

English learning web application built with React and TypeScript. Users create questionnaires with Korean questions and English answers, which are then broken into sentence pairs for sequential learning. The app features word-by-word highlighting during playback and integrates with Google's Gemini API for AI-powered Korean-to-English translation at different difficulty levels (Easy/Medium/Hard corresponding to IELTS 6-7, 7-8, 8-9).

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm start

# Run tests
npm test

# Build for production
npm build
```

## Core Architecture

### State Management
- **Zustand stores** in `src/stores/appStore.ts`:
  - `useAppStore`: Global app state (questionnaires, sessions, prompts, API interactions)
  - `useLearningStore`: Learning screen state (sentence navigation, word highlighting playback)

### Data Layer
- **IndexedDB via Dexie** (`src/services/database.ts`):
  - `questionnaires`: Server-side questionnaire data
  - `modifiedQuestionnaires`: Client-side edited questionnaires with sentence pairs
  - `answerSessions`: User learning session history
  - `prompts`: Difficulty-based translation templates

- **Data Flow**:
  1. User creates questionnaire with Korean questions
  2. Gemini API translates to English based on difficulty
  3. `SentenceProcessor` splits Q&A pairs into indexed sentence entries
  4. `ModifiedQuestionnaire` stored in IndexedDB for offline access

### Key Services

**GeminiApiService** (`src/services/geminiApi.ts`):
- Model: `gemini-2.5-flash-lite-preview-06-17`
- API key stored in `localStorage` (key: `gemini_api_key`)
- Translation uses difficulty-based prompt templates with `${sentence}` placeholder
- Includes batch translation with 500ms delay for rate limiting

**SentenceProcessor** (`src/services/sentenceProcessor.ts`):
- Splits Korean/English text into sentences using pattern: `/[.!?。！？]+\s*/g`
- Creates indexed `SentenceEntry[]` with 1-based indexing
- Generates cumulative text for sequential sentence display
- Provides word splitting for highlight animation (800ms interval per word)

**LocalDatabaseService** (`src/services/database.ts`):
- All queries return promises
- `modifiedQuestionnaires` ordered by `lastAccessed` DESC
- `answerSessions` ordered by `answerDateTime` DESC

### Routing
- `/` - HomeScreen (questionnaire list, creation, settings)
- `/learn/:id` - SentenceLearningScreen (word-by-word playback with arrow key navigation)

## Important Implementation Details

### Sentence Learning Flow
1. User clicks "학습하기" on questionnaire card
2. Screen loads sentences from `ModifiedQuestionnaire.sentences[]`
3. Playback button starts word-by-word highlighting at 800ms intervals
4. Arrow keys:
   - ↑ Show all sentences cumulatively
   - ↓ Show current sentence only
   - ← Previous sentence
   - → Next sentence

### Gemini API Integration
- Prompt templates must contain `${sentence}` placeholder
- Default prompts request "natural English nuance suitable for IELTS Level X-X"
- Prompts explicitly ask to repeat input and omit quote markers
- Error handling for 401 (invalid key), 429 (rate limit), 404 (model not found)

### Data Types (`src/types/index.ts`)
- `Questionnaire`: Server data model (originalQuestions, difficulty, prompts)
- `ModifiedQuestionnaire`: Client model with processed sentence pairs
- `SentenceEntry`: `{index, korean, english, memo?}` - core learning unit
- `AnswerSession`: User practice history with timestamp

## Technology Stack
- React 19, TypeScript 4.9
- Material-UI (MUI) for components
- Zustand for state management
- Dexie (IndexedDB wrapper) for offline storage
- Axios for HTTP requests
- React Router for navigation
