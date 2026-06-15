import { create } from 'zustand';
import {
  GoogleSheetsConfig,
  AudioArticle,
  SubDeck,
  AppState,
  LearningState
} from '../types';
import { localDB } from '../services/database';
import { GoogleSheetsService } from '../services/googleSheetsService';
import { GoogleDriveService, DriveAuthError } from '../services/googleDriveService';

interface AppStore extends AppState {
  // OAuth state
  accessToken: string | null;
  isAuthenticated: boolean;

  // Audio articles (Drive-backed)
  audioArticles: AudioArticle[];

  // SubDecks
  subDecks: SubDeck[];

  // Dirty tracking — IDs of articles with unsaved review changes
  dirtyAudioIds: Set<string>;
  pendingDeleteIds: Set<string>;

  // Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Article actions
  loadArticles: () => Promise<void>;
  fetchArticlesFromSheets: () => Promise<void>;
  deleteArticle: (id: string) => Promise<void>;
  updateLastAccessed: (id: string) => Promise<void>;

  // Audio article actions (Drive SSOT)
  loadAudioArticles: () => Promise<void>;
  saveAudioArticle: (article: AudioArticle) => Promise<void>;
  deleteAudioArticle: (id: string) => Promise<void>;
  saveDirtyArticles: () => Promise<void>; // 명시적 저장 — dirty → Drive

  // SubDeck actions
  loadSubDecks: () => Promise<void>;
  createSubDeck: (parentId: string, title: string, startIndex: number, endIndex: number) => Promise<void>;
  deleteSubDeck: (id: string) => Promise<void>;

  // Review actions
  markReviewDone: (type: 'article' | 'audio' | 'subdeck', id: string) => Promise<void>;
  cycleReviewInterval: (type: 'article' | 'audio' | 'subdeck', id: string) => Promise<void>;

  // OAuth actions
  setAccessToken: (token: string | null) => void;
  loadAccessToken: () => void;
  logout: () => void;

  // Google Sheets config actions
  setGoogleSheetsConfig: (config: GoogleSheetsConfig) => void;
  loadGoogleSheetsConfig: () => void;
  clearGoogleSheetsConfig: () => void;
}

/** Helper: get DriveService from current token, or null */
function getDriveService(token: string | null): GoogleDriveService | null {
  if (!token) return null;
  return new GoogleDriveService(token);
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Initial state
  articles: [],
  audioArticles: [],
  subDecks: [],
  dirtyAudioIds: new Set<string>(),
  pendingDeleteIds: new Set<string>(),
  isLoading: false,
  error: null,
  googleSheetsConfig: null,
  accessToken: null,
  isAuthenticated: false,

  // Basic actions
  setLoading: (loading: boolean) => set({ isLoading: loading }),
  setError: (error: string | null) => set({ error }),

  // Article actions (Text — Sheets-based, unchanged)
  loadArticles: async () => {
    try {
      set({ isLoading: true, error: null });
      const articles = await localDB.getArticles();
      set({ articles });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load articles';
      set({ error: errorMessage });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchArticlesFromSheets: async () => {
    const config = get().googleSheetsConfig;
    const token = get().accessToken;

    if (!config) {
      set({ error: 'Google Sheets configuration not found' });
      return;
    }

    if (!token) {
      set({ error: 'Please sign in with Google first' });
      return;
    }

    try {
      set({ isLoading: true, error: null });
      const sheetsService = new GoogleSheetsService(token, config);
      const articles = await sheetsService.fetchArticles();

      // Save to IndexedDB
      for (const article of articles) {
        await localDB.saveArticle(article);
      }

      await get().loadArticles();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch articles from sheets';
      set({ error: errorMessage });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteArticle: async (id: string) => {
    try {
      set({ isLoading: true, error: null });
      await localDB.deleteArticle(id);

      const currentArticles = get().articles;
      const updatedArticles = currentArticles.filter(a => a.id !== id);
      set({ articles: updatedArticles });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete article';
      set({ error: errorMessage });
    } finally {
      set({ isLoading: false });
    }
  },

  updateLastAccessed: async (id: string) => {
    try {
      await localDB.updateLastAccessed(id);
      await get().loadArticles();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update last accessed';
      set({ error: errorMessage });
    }
  },

  // ── Audio article actions (Drive SSOT) ─────────────────

  loadAudioArticles: async () => {
    const drive = getDriveService(get().accessToken);
    if (!drive) {
      // No token — nothing to load
      set({ audioArticles: [] });
      return;
    }
    try {
      const audioArticles = await drive.listArticles();
      set({ audioArticles });
    } catch (error) {
      if (error instanceof DriveAuthError) {
        localDB.clearAccessToken();
        set({ accessToken: null, isAuthenticated: false, error: '토큰 만료 — 재로그인 후 다시 시도' });
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load audio articles';
        set({ error: errorMessage });
      }
    }
  },

  saveAudioArticle: async (article: AudioArticle) => {
    const drive = getDriveService(get().accessToken);
    if (!drive) {
      set({ error: 'Drive 인증 필요' });
      return;
    }
    try {
      // Save JSON metadata to Drive
      await drive.saveArticle(article);

      // Upload MP3 to Drive (only if not already there) + cache locally
      if (article.audioBlob) {
        await drive.uploadMp3(article.id, article.audioBlob);
        await localDB.cacheMp3(article.id, article.audioBlob);
      }

      // Reload list from Drive
      await get().loadAudioArticles();
    } catch (error) {
      if (error instanceof DriveAuthError) {
        localDB.clearAccessToken();
        set({ accessToken: null, isAuthenticated: false, error: '토큰 만료 — 재로그인 후 다시 시도' });
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Failed to save audio article';
        set({ error: errorMessage });
      }
    }
  },

  deleteAudioArticle: async (id: string) => {
    // Mark for deletion locally — actual Drive delete on "저장"
    const pending = new Set(get().pendingDeleteIds);
    if (pending.has(id)) {
      // Toggle: undo delete
      pending.delete(id);
    } else {
      pending.add(id);
    }
    set({ pendingDeleteIds: pending });
  },

  // SubDeck actions
  loadSubDecks: async () => {
    try {
      // Drive splitPoints = SSOT. Reconcile local SubDecks with Drive state.
      const audioArticles = get().audioArticles;
      for (const aa of audioArticles) {
        const existing = await localDB.getSubDecksByParent(aa.id);

        if (!aa.splitPoints?.length) {
          // No splitPoints in Drive → remove any stale local SubDecks
          for (const old of existing) {
            await localDB.deleteSubDeck(old.id);
          }
          continue;
        }

        // Build expected ranges from splitPoints
        const sorted = [...aa.splitPoints].sort((a, b) => a - b);
        const expectedRanges: { start: number; end: number }[] = [];
        let prev = 0;
        for (let i = 0; i <= sorted.length; i++) {
          const end = i < sorted.length ? sorted[i] + 1 : (aa.sentences?.length ?? 0);
          expectedRanges.push({ start: prev, end });
          prev = end;
        }

        // Check if existing SubDecks match expected ranges
        const matches = existing.length === expectedRanges.length &&
          expectedRanges.every((r, i) => existing[i].startIndex === r.start && existing[i].endIndex === r.end);

        if (matches) continue; // Already in sync

        // Mismatch → rebuild. Restore review from Drive subDeckReviews first, then local fallback.
        const driveReviewMap = new Map(
          (aa.subDeckReviews || []).map(r => [`${r.startIndex}_${r.endIndex}`, r])
        );
        const localReviewMap = new Map(existing.map(d => [`${d.startIndex}_${d.endIndex}`, d]));
        for (const old of existing) {
          await localDB.deleteSubDeck(old.id);
        }

        for (let i = 0; i < expectedRanges.length; i++) {
          const r = expectedRanges[i];
          const driveReview = driveReviewMap.get(`${r.start}_${r.end}`);
          const localReview = localReviewMap.get(`${r.start}_${r.end}`);
          await localDB.saveSubDeck({
            id: `${aa.id}_${r.start}_${r.end}_${Date.now()}_${i}`,
            parentId: aa.id,
            title: `${aa.title} Part ${i + 1}`,
            startIndex: r.start,
            endIndex: r.end,
            nextReviewDate: driveReview?.nextReviewDate ? new Date(driveReview.nextReviewDate) : localReview?.nextReviewDate ?? null,
            reviewInterval: driveReview?.reviewInterval ?? localReview?.reviewInterval ?? 0,
            createdAt: localReview?.createdAt ?? new Date(),
            lastAccessed: driveReview?.lastAccessed ? new Date(driveReview.lastAccessed) : localReview?.lastAccessed ?? new Date(),
          });
        }
      }

      // Also clean up orphaned SubDecks (parent deleted from Drive)
      const allSubDecks = await localDB.getSubDecks();
      const audioIds = new Set(audioArticles.map(a => a.id));
      for (const sd of allSubDecks) {
        if (!audioIds.has(sd.parentId)) {
          await localDB.deleteSubDeck(sd.id);
        }
      }

      const subDecks = await localDB.getSubDecks();
      set({ subDecks });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load sub-decks';
      set({ error: errorMessage });
    }
  },

  createSubDeck: async (parentId: string, title: string, startIndex: number, endIndex: number) => {
    try {
      const subDeck: SubDeck = {
        id: `${parentId}_${startIndex}_${endIndex}_${Date.now()}`,
        parentId,
        title,
        startIndex,
        endIndex,
        nextReviewDate: null,
        reviewInterval: 0,
        createdAt: new Date(),
        lastAccessed: new Date(),
      };
      await localDB.saveSubDeck(subDeck);
      await get().loadSubDecks();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create sub-deck';
      set({ error: errorMessage });
    }
  },

  deleteSubDeck: async (id: string) => {
    try {
      await localDB.deleteSubDeck(id);
      const current = get().subDecks;
      set({ subDecks: current.filter(s => s.id !== id) });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete sub-deck';
      set({ error: errorMessage });
    }
  },

  // Save all dirty audio articles to Drive (user clicks "저장")
  saveDirtyArticles: async () => {
    const drive = getDriveService(get().accessToken);
    if (!drive) return;
    const dirtyIds = get().dirtyAudioIds;
    const pendingDeletes = get().pendingDeleteIds;
    if (dirtyIds.size === 0 && pendingDeletes.size === 0) return;

    try {
      set({ isLoading: true });

      // 1. Process pending deletes
      for (const deleteId of Array.from(pendingDeletes)) {
        await drive.deleteArticle(deleteId);
        await localDB.removeCachedMp3(deleteId);
        await localDB.deleteSubDecksByParent(deleteId);
      }
      if (pendingDeletes.size > 0) {
        const remaining = get().audioArticles.filter(a => !pendingDeletes.has(a.id));
        set({ audioArticles: remaining, pendingDeleteIds: new Set() });
        await get().loadSubDecks();
      }

      // 2. Save dirty articles (skip any that were just deleted)
      for (const articleId of Array.from(dirtyIds)) {
        if (pendingDeletes.has(articleId)) continue;
        const article = get().audioArticles.find(a => a.id === articleId);
        if (!article) continue;

        // Collect SubDeck review state into article
        const subs = get().subDecks.filter(sd => sd.parentId === articleId);
        const subDeckReviews = subs.map(sd => ({
          startIndex: sd.startIndex,
          endIndex: sd.endIndex,
          nextReviewDate: sd.nextReviewDate ? new Date(sd.nextReviewDate).toISOString() : null,
          reviewInterval: sd.reviewInterval || 0,
          lastAccessed: sd.lastAccessed ? new Date(sd.lastAccessed).toISOString() : undefined,
        }));

        const toSave: AudioArticle = { ...article, subDeckReviews };
        await drive.saveArticle(toSave);
      }
      set({ dirtyAudioIds: new Set() });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Drive 저장 실패';
      set({ error: errorMessage });
    } finally {
      set({ isLoading: false });
    }
  },

  // Review actions — local state only, marks dirty (Drive save on explicit "저장")
  markReviewDone: async (type: 'article' | 'audio' | 'subdeck', id: string) => {
    try {
      if (type === 'audio') {
        const article = get().audioArticles.find(a => a.id === id);
        if (!article) return;
        const interval = article.reviewInterval || 1;
        const next = new Date();
        next.setDate(next.getDate() + interval);
        const updated: AudioArticle = { ...article, reviewInterval: interval, nextReviewDate: next, lastAccessed: new Date() };
        const dirty = new Set(get().dirtyAudioIds);
        dirty.add(id);
        set({ audioArticles: get().audioArticles.map(a => a.id === id ? updated : a), dirtyAudioIds: dirty });
      } else if (type === 'article') {
        await localDB.markReviewDone('article', id);
        await get().loadArticles();
        const article = await localDB.getArticleById(id);
        if (article?.sheetRow) {
          const token = get().accessToken;
          const config = get().googleSheetsConfig;
          if (token && config) {
            const sheetsService = new GoogleSheetsService(token, config);
            sheetsService.syncReviewFields(article).catch(() => {});
          }
        }
      } else {
        // SubDeck: local state + mark parent dirty
        const deck = get().subDecks.find(d => d.id === id);
        if (!deck) return;
        const interval = deck.reviewInterval || 1;
        const next = new Date();
        next.setDate(next.getDate() + interval);
        const updated = { ...deck, reviewInterval: interval, nextReviewDate: next, lastAccessed: new Date() };
        const dirty = new Set(get().dirtyAudioIds);
        dirty.add(deck.parentId);
        set({ subDecks: get().subDecks.map(d => d.id === id ? updated : d), dirtyAudioIds: dirty });
        await localDB.markReviewDone('subdeck', id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to mark review done';
      set({ error: errorMessage });
    }
  },

  cycleReviewInterval: async (type: 'article' | 'audio' | 'subdeck', id: string) => {
    try {
      if (type === 'audio') {
        const article = get().audioArticles.find(a => a.id === id);
        if (!article) return;
        const newInterval = localDB.cycleInterval(article.reviewInterval || 0);
        let nextReviewDate: Date | null = null;
        if (newInterval > 0) {
          nextReviewDate = new Date();
          nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);
        }
        const updated: AudioArticle = { ...article, reviewInterval: newInterval, nextReviewDate, lastAccessed: new Date() };
        const dirty = new Set(get().dirtyAudioIds);
        dirty.add(id);
        set({ audioArticles: get().audioArticles.map(a => a.id === id ? updated : a), dirtyAudioIds: dirty });
      } else if (type === 'article') {
        const record = await localDB.getArticleById(id);
        if (!record) return;
        const newInterval = localDB.cycleInterval(record.reviewInterval || 0);
        await localDB.setReviewInterval('article', id, newInterval);
        await get().loadArticles();
        const article = await localDB.getArticleById(id);
        if (article?.sheetRow) {
          const token = get().accessToken;
          const config = get().googleSheetsConfig;
          if (token && config) {
            const sheetsService = new GoogleSheetsService(token, config);
            sheetsService.syncReviewFields(article).catch(() => {});
          }
        }
      } else {
        // SubDeck: local state + mark parent dirty
        const deck = get().subDecks.find(d => d.id === id);
        if (!deck) return;
        const newInterval = localDB.cycleInterval(deck.reviewInterval || 0);
        let nextReviewDate: Date | null = null;
        if (newInterval > 0) {
          nextReviewDate = new Date();
          nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);
        }
        const updated = { ...deck, reviewInterval: newInterval, nextReviewDate };
        const dirty = new Set(get().dirtyAudioIds);
        dirty.add(deck.parentId);
        set({ subDecks: get().subDecks.map(d => d.id === id ? updated : d), dirtyAudioIds: dirty });
        await localDB.setReviewInterval('subdeck', id, newInterval);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to cycle review interval';
      set({ error: errorMessage });
    }
  },

  // OAuth actions
  setAccessToken: (token: string | null) => {
    if (token) {
      localDB.saveAccessToken(token);
      set({ accessToken: token, isAuthenticated: true });
    } else {
      localDB.clearAccessToken();
      set({ accessToken: null, isAuthenticated: false });
    }
  },

  loadAccessToken: () => {
    const token = localDB.getAccessToken();
    if (token) {
      set({ accessToken: token, isAuthenticated: true });
    }
  },

  logout: () => {
    localDB.clearAccessToken();
    set({ accessToken: null, isAuthenticated: false });
  },

  // Google Sheets config actions
  setGoogleSheetsConfig: (config: GoogleSheetsConfig) => {
    localDB.saveGoogleSheetsConfig(config);
    set({ googleSheetsConfig: config });
  },

  loadGoogleSheetsConfig: () => {
    const config = localDB.getGoogleSheetsConfig();
    set({ googleSheetsConfig: config });
  },

  clearGoogleSheetsConfig: () => {
    localDB.clearGoogleSheetsConfig();
    set({ googleSheetsConfig: null });
  },
}));

// Learning state store for sentence learning screen
interface LearningStore extends LearningState {
  // Window size state
  windowSize: number | 'full'; // 누적 윈도우 크기 (숫자 또는 'full')

  // Actions
  setCurrentIndex: (index: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setIsCumulative: (cumulative: boolean) => void;
  setWindowSize: (size: number | 'full') => void;
  resetLearningState: () => void;

  // Navigation actions
  goToNextSentence: (maxIndex: number) => void;
  goToPreviousSentence: () => void;
}

export const useLearningStore = create<LearningStore>((set, get) => ({
  // Initial state
  currentIndex: 1,
  isPlaying: false,
  isCumulative: true, // 기본값: 누적 표시
  windowSize: 'full', // 기본값: 전체 누적

  // Actions
  setCurrentIndex: (index: number) => set({ currentIndex: index }),
  setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),
  setIsCumulative: (cumulative: boolean) => set({ isCumulative: cumulative }),
  setWindowSize: (size: number | 'full') => set({ windowSize: size }),

  resetLearningState: () => set({
    currentIndex: 1,
    isPlaying: false,
    isCumulative: true,
    windowSize: 'full'
  }),

  // Navigation actions
  goToNextSentence: (maxIndex: number) => {
    const currentIndex = get().currentIndex;
    if (currentIndex < maxIndex) {
      set({
        currentIndex: currentIndex + 1,
        isPlaying: false
      });
    }
  },

  goToPreviousSentence: () => {
    const currentIndex = get().currentIndex;
    if (currentIndex > 1) {
      set({
        currentIndex: currentIndex - 1,
        isPlaying: false
      });
    }
  },
}));
