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

  // Audio articles
  audioArticles: AudioArticle[];

  // SubDecks
  subDecks: SubDeck[];

  // Sync state
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  syncError: string | null;

  // Sync actions
  syncDrive: () => Promise<void>;

  // Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Article actions
  loadArticles: () => Promise<void>;
  fetchArticlesFromSheets: () => Promise<void>;
  deleteArticle: (id: string) => Promise<void>;
  updateLastAccessed: (id: string) => Promise<void>;

  // Audio article actions
  loadAudioArticles: () => Promise<void>;
  saveAudioArticle: (article: AudioArticle) => Promise<void>;
  deleteAudioArticle: (id: string) => Promise<void>;

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

export const useAppStore = create<AppStore>((set, get) => ({
  // Initial state
  articles: [],
  audioArticles: [],
  subDecks: [],
  isLoading: false,
  error: null,
  googleSheetsConfig: null,
  accessToken: null,
  isAuthenticated: false,
  isSyncing: false,
  lastSyncedAt: null,
  syncError: null,

  // Sync action
  syncDrive: async () => {
    const token = get().accessToken;
    if (!token) {
      set({ syncError: 'Not authenticated' });
      return;
    }
    try {
      set({ isSyncing: true, syncError: null });
      const driveService = new GoogleDriveService(token);
      await driveService.syncUp();
      await driveService.syncDown();
      // Reload local data after sync-down
      const audioArticles = await localDB.getAudioArticles();
      set({ audioArticles, lastSyncedAt: new Date() });
      localStorage.setItem('last_synced_at', new Date().toISOString());
    } catch (error) {
      if (error instanceof DriveAuthError) {
        // Token expired — force re-login
        localDB.clearAccessToken();
        set({ accessToken: null, isAuthenticated: false, syncError: '토큰 만료 — 재로그인 후 다시 시도' });
      } else {
        const msg = error instanceof Error ? error.message : 'Sync failed';
        set({ syncError: msg });
      }
    } finally {
      set({ isSyncing: false });
    }
  },

  // Basic actions
  setLoading: (loading: boolean) => set({ isLoading: loading }),
  setError: (error: string | null) => set({ error }),

  // Article actions
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

  // Audio article actions
  loadAudioArticles: async () => {
    try {
      const audioArticles = await localDB.getAudioArticles();
      set({ audioArticles });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load audio articles';
      set({ error: errorMessage });
    }
  },

  saveAudioArticle: async (article: AudioArticle) => {
    try {
      await localDB.saveAudioArticle(article);
      await get().loadAudioArticles();
      // Immediate Drive upload (fire-and-forget)
      const token = get().accessToken;
      if (token) {
        new GoogleDriveService(token).uploadArticle(article).catch(() => {});
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save audio article';
      set({ error: errorMessage });
    }
  },

  deleteAudioArticle: async (id: string) => {
    try {
      await localDB.deleteAudioArticle(id);
      const current = get().audioArticles;
      set({ audioArticles: current.filter(a => a.id !== id) });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete audio article';
      set({ error: errorMessage });
    }
  },

  // SubDeck actions
  loadSubDecks: async () => {
    try {
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

  // Review actions
  markReviewDone: async (type: 'article' | 'audio' | 'subdeck', id: string) => {
    try {
      await localDB.markReviewDone(type, id);
      if (type === 'article') {
        await get().loadArticles();
        // Reverse-sync review fields back to Google Sheets
        const article = await localDB.getArticleById(id);
        if (article?.sheetRow) {
          const token = get().accessToken;
          const config = get().googleSheetsConfig;
          if (token && config) {
            const sheetsService = new GoogleSheetsService(token, config);
            sheetsService.syncReviewFields(article).catch(() => {
              // Silent fail — local state is already saved
            });
          }
        }
      } else if (type === 'audio') await get().loadAudioArticles();
      else await get().loadSubDecks();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to mark review done';
      set({ error: errorMessage });
    }
  },

  cycleReviewInterval: async (type: 'article' | 'audio' | 'subdeck', id: string) => {
    try {
      let record: any;
      if (type === 'article') record = await localDB.getArticleById(id);
      else if (type === 'audio') record = await localDB.getAudioArticleById(id);
      else {
        const decks = await localDB.getSubDecks();
        record = decks.find(d => d.id === id);
      }
      if (!record) return;
      const newInterval = localDB.cycleInterval(record.reviewInterval || 0);
      await localDB.setReviewInterval(type, id, newInterval);
      if (type === 'article') {
        await get().loadArticles();
        // Reverse-sync review fields back to Google Sheets
        const article = await localDB.getArticleById(id);
        if (article?.sheetRow) {
          const token = get().accessToken;
          const config = get().googleSheetsConfig;
          if (token && config) {
            const sheetsService = new GoogleSheetsService(token, config);
            sheetsService.syncReviewFields(article).catch(() => {
              // Silent fail — local state is already saved
            });
          }
        }
      } else if (type === 'audio') await get().loadAudioArticles();
      else await get().loadSubDecks();
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
