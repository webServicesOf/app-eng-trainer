import { create } from 'zustand';
import {
  GoogleSheetsConfig,
  AppState,
  LearningState
} from '../types';
import { localDB } from '../services/database';
import { GoogleSheetsService } from '../services/googleSheetsService';

interface AppStore extends AppState {
  // OAuth state
  accessToken: string | null;
  isAuthenticated: boolean;

  // Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Article actions
  loadArticles: () => Promise<void>;
  fetchArticlesFromSheets: () => Promise<void>;
  deleteArticle: (id: string) => Promise<void>;
  updateLastAccessed: (id: string) => Promise<void>;

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
  isLoading: false,
  error: null,
  googleSheetsConfig: null,
  accessToken: null,
  isAuthenticated: false,

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
