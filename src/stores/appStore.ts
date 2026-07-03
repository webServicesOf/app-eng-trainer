import { create } from 'zustand';
import {
  GoogleSheetsConfig,
  AudioArticle,
  ArticleSummary,
  StoreArticle,
  SummaryArticle,
  FullArticle,
  SubDeck,
  SentenceEntry,
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

  // Audio articles (Drive-backed, discriminated union)
  audioArticles: StoreArticle[];

  // SubDecks
  subDecks: SubDeck[];

  // Dirty tracking — IDs of articles with unsaved review changes
  dirtyAudioIds: Set<string>;
  pendingDeleteIds: Set<string>;
  cleanAudioIntervals: Map<string, number>; // Drive-saved intervals for dirty comparison
  cleanSubDeckIntervals: Map<string, number>; // Drive-saved subdeck intervals
  cleanAudioSnapshots: Map<string, string>; // JSON snapshot of mutable fields per article

  // Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Article actions
  loadArticles: () => Promise<void>;
  fetchArticlesFromSheets: () => Promise<void>;
  deleteArticle: (id: string) => Promise<void>;
  updateLastAccessed: (id: string) => Promise<void>;

  // Audio article actions (Drive SSOT, CQRS-lite)
  loadAudioArticles: () => Promise<void>;
  loadFullArticle: (id: string) => Promise<void>; // on-demand full JSON load → SummaryArticle → FullArticle
  saveAudioArticle: (article: AudioArticle) => Promise<void>; // upload flow (new article)
  deleteAudioArticle: (id: string) => Promise<void>;
  saveDirtyArticles: () => Promise<void>; // 명시적 저장 — dirty → Drive
  getFullArticle: (id: string) => FullArticle | undefined; // type-safe accessor
  diagnoseCorrupted: () => Promise<void>; // console diagnostic

  // SubDeck actions
  loadSubDecks: () => Promise<void>;
  createSubDeck: (parentId: string, title: string, startIndex: number, endIndex: number) => Promise<void>;
  deleteSubDeck: (id: string) => Promise<void>;

  // Review actions
  markReviewDone: (type: 'article' | 'audio' | 'subdeck' | 'saved-sentences', id: string) => Promise<void>;
  cycleReviewInterval: (type: 'article' | 'audio' | 'subdeck' | 'saved-sentences', id: string) => Promise<void>;

  // Saved state (Drive SSOT)
  updateSavedSentenceIndices: (articleId: string, indices: number[]) => void;
  toggleSavedDeck: (articleId: string, subDeckId?: string) => void;
  updateArticleSentences: (articleId: string, sentences: SentenceEntry[]) => void;
  updateArticleSource: (articleId: string, source: string) => void;

  // OAuth actions
  setAccessToken: (token: string | null, expiresIn?: number) => void;
  loadAccessToken: () => void;
  logout: () => void;

  // Google Sheets config actions
  setGoogleSheetsConfig: (config: GoogleSheetsConfig) => void;
  loadGoogleSheetsConfig: () => void;
  clearGoogleSheetsConfig: () => void;
}

/** Snapshot mutable fields of StoreArticle for dirty comparison */
function snapshotArticle(a: StoreArticle): string {
  return JSON.stringify({
    ri: a.reviewInterval || 0,
    sd: a.savedAsDeck || false,
    si: (a.savedSentenceIndices || []).slice().sort(),
    sr: a.savedSentenceReview || null,
    sdr: (a.subDeckReviews || [])
      .filter(r => r.saved || r.reviewInterval || r.nextReviewDate) // exclude empty entries
      .map(r => ({ s: r.startIndex, e: r.endIndex, ri: r.reviewInterval, saved: r.saved || false }))
      .sort((a, b) => a.s - b.s || a.e - b.e),
    hidden: a.kind === 'loaded' ? a.sentences.filter(s => s.hidden).map(s => s.index) : [],
    src: a.source || '',
  });
}

/** Convert StoreArticle → ArticleSummary for index.json */
function toIndexSummary(a: StoreArticle): ArticleSummary {
  return {
    id: a.id,
    title: a.title,
    reviewInterval: a.reviewInterval || 0,
    nextReviewDate: a.nextReviewDate ? a.nextReviewDate.toISOString() : null,
    sentenceCount: a.kind === 'loaded' ? a.sentences.length : a.sentenceCount,
    savedAsDeck: a.savedAsDeck,
    savedSentenceIndices: a.savedSentenceIndices,
    savedSentenceReview: a.savedSentenceReview,
    subDeckReviews: a.subDeckReviews,
    splitPoints: a.splitPoints,
    source: a.source,
    createdAt: a.createdAt.toISOString(),
    lastAccessed: a.lastAccessed.toISOString(),
  };
}

/** Get sentence count from StoreArticle regardless of kind */
function getSentenceCount(a: StoreArticle): number {
  return a.kind === 'loaded' ? a.sentences.length : a.sentenceCount;
}

/** Check if article matches its clean snapshot; if so, remove from dirty */
function checkCleanAndUpdateDirty(get: () => AppStore, set: (partial: Partial<AppStore>) => void, articleId: string) {
  const article = get().audioArticles.find(a => a.id === articleId);
  if (!article) return;
  const clean = get().cleanAudioSnapshots.get(articleId);
  const current = snapshotArticle(article);
  const shouldBeDirty = current !== clean;
  const isDirty = get().dirtyAudioIds.has(articleId);
  if (shouldBeDirty === isDirty) return;
  const dirty = new Set(get().dirtyAudioIds);
  if (shouldBeDirty) dirty.add(articleId);
  else dirty.delete(articleId);
  set({ dirtyAudioIds: dirty });
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
  cleanAudioIntervals: new Map<string, number>(),
  cleanSubDeckIntervals: new Map<string, number>(),
  cleanAudioSnapshots: new Map<string, string>(),
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
      // Don't clear existing articles — token may be temporarily unavailable
      return;
    }
    try {
      console.log('[loadAudioArticles] START');
      // Try index-based loading first (1 file download vs N)
      const summaries = await drive.loadIndex();
      console.log('[loadAudioArticles] loadIndex result:', summaries ? `${summaries.length} summaries` : 'null');
      if (summaries && summaries.length > 0) {
        const existingArticles = get().audioArticles;
        const articles: StoreArticle[] = summaries.map((s: ArticleSummary): StoreArticle => {
          // Preserve FullArticle if already loaded in store
          const existing = existingArticles.find(a => a.id === s.id);
          if (existing && existing.kind === 'loaded') {
            // Update review fields from index (may be newer) but keep sentences
            return {
              ...existing,
              reviewInterval: s.reviewInterval || existing.reviewInterval,
              nextReviewDate: s.nextReviewDate ? new Date(s.nextReviewDate) : existing.nextReviewDate,
              savedAsDeck: s.savedAsDeck ?? existing.savedAsDeck,
              savedSentenceIndices: s.savedSentenceIndices ?? existing.savedSentenceIndices,
              savedSentenceReview: s.savedSentenceReview ?? existing.savedSentenceReview,
              subDeckReviews: s.subDeckReviews ?? existing.subDeckReviews,
            };
          }
          // Create SummaryArticle — no sentences field
          const summary: SummaryArticle = {
            kind: 'summary',
            id: s.id,
            title: s.title,
            sentenceCount: s.sentenceCount,
            splitPoints: s.splitPoints,
            subDeckReviews: s.subDeckReviews,
            savedAsDeck: s.savedAsDeck,
            savedSentenceIndices: s.savedSentenceIndices,
            savedSentenceReview: s.savedSentenceReview,
            source: s.source,
            nextReviewDate: s.nextReviewDate ? new Date(s.nextReviewDate) : null,
            reviewInterval: s.reviewInterval || 0,
            createdAt: new Date(s.createdAt),
            lastAccessed: new Date(s.lastAccessed),
          };
          return summary;
        });
        articles.sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());
        set({ audioArticles: articles });
        return;
      }

      // Fallback: full scan + rebuild index (self-healing)
      console.log('[loadAudioArticles] falling back to rebuildIndex...');
      const rawArticles = await drive.rebuildIndex();
      console.log('[loadAudioArticles] rebuildIndex returned', rawArticles.length, 'articles');
      const cleanIntervals = new Map<string, number>();
      const cleanSnapshots = new Map<string, string>();
      // rebuildIndex returns full AudioArticle[] — convert to FullArticle[]
      const articles: StoreArticle[] = rawArticles.map((a): FullArticle => ({
        kind: 'loaded',
        id: a.id,
        title: a.title,
        sentences: a.sentences,
        audioBlob: a.audioBlob,
        audioUrl: a.audioUrl,
        splitPoints: a.splitPoints,
        subDeckReviews: a.subDeckReviews,
        savedAsDeck: a.savedAsDeck,
        savedSentenceIndices: a.savedSentenceIndices,
        savedSentenceReview: a.savedSentenceReview,
        source: a.source,
        nextReviewDate: a.nextReviewDate,
        reviewInterval: a.reviewInterval || 0,
        createdAt: a.createdAt,
        lastAccessed: a.lastAccessed,
      }));
      articles.forEach(a => {
        cleanIntervals.set(a.id, a.reviewInterval || 0);
        cleanSnapshots.set(a.id, snapshotArticle(a));
      });
      set({ audioArticles: articles, cleanAudioIntervals: cleanIntervals, cleanAudioSnapshots: cleanSnapshots });
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

  loadFullArticle: async (id: string) => {
    console.log('[loadFullArticle] START', id);
    // Skip if already loaded
    const existing = get().audioArticles.find(a => a.id === id);
    if (existing?.kind === 'loaded') {
      console.log('[loadFullArticle] already loaded, skip');
      return;
    }
    const drive = getDriveService(get().accessToken);
    if (!drive) { console.error('[loadFullArticle] no drive service'); throw new Error('Drive 인증 필요'); }
    try {
      const rawArticle = await drive.getArticle(id);
      console.log('[loadFullArticle] getArticle result:', rawArticle ? { id: rawArticle.id, sentencesLen: rawArticle.sentences.length } : 'NULL');
      if (!rawArticle) throw new Error(`Article ${id} not found on Drive`);
      // Merge summary-level fields (may have local changes) with full article data
      const prev = get().audioArticles.find(a => a.id === id);
      const loaded: FullArticle = {
        kind: 'loaded',
        id: rawArticle.id,
        title: rawArticle.title,
        sentences: rawArticle.sentences,
        splitPoints: rawArticle.splitPoints,
        subDeckReviews: rawArticle.subDeckReviews,
        savedAsDeck: prev?.savedAsDeck ?? rawArticle.savedAsDeck,
        savedSentenceIndices: prev?.savedSentenceIndices ?? rawArticle.savedSentenceIndices,
        savedSentenceReview: prev?.savedSentenceReview ?? rawArticle.savedSentenceReview,
        source: rawArticle.source,
        nextReviewDate: prev?.nextReviewDate ?? rawArticle.nextReviewDate,
        reviewInterval: prev?.reviewInterval ?? rawArticle.reviewInterval ?? 0,
        createdAt: rawArticle.createdAt,
        lastAccessed: rawArticle.lastAccessed,
      };
      set({
        audioArticles: get().audioArticles.map(a => a.id === id ? loaded : a),
      });
      // Create clean snapshot now that full data is available
      const cleanSnapshots = new Map(get().cleanAudioSnapshots);
      const cleanIntervals = new Map(get().cleanAudioIntervals);
      cleanSnapshots.set(id, snapshotArticle(loaded));
      cleanIntervals.set(id, loaded.reviewInterval || 0);
      set({ cleanAudioSnapshots: cleanSnapshots, cleanAudioIntervals: cleanIntervals });
    } catch (error) {
      if (error instanceof DriveAuthError) {
        localDB.clearAccessToken();
        set({ accessToken: null, isAuthenticated: false, error: '토큰 만료 — 재로그인 후 다시 시도' });
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load article';
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
      // Save JSON metadata to Drive (AudioArticle persistence type)
      await drive.saveArticle(article);

      // Update index with new article
      await drive.updateIndex(article);

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
          const end = i < sorted.length ? sorted[i] + 1 : getSentenceCount(aa);
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
      const cleanSdIntervals = new Map<string, number>();
      subDecks.forEach(sd => cleanSdIntervals.set(sd.id, sd.reviewInterval || 0));
      set({ subDecks, cleanSubDeckIntervals: cleanSdIntervals });
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
  // CQRS-lite: full article dirty → write {id}.json + index.json
  //            summary-only dirty → write index.json only
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

      // 2. Save dirty articles — discriminated union eliminates need for sentences guard
      for (const articleId of Array.from(dirtyIds)) {
        if (pendingDeletes.has(articleId)) continue;
        const article = get().audioArticles.find(a => a.id === articleId);
        if (!article) continue;

        if (article.kind === 'loaded') {
          // FullArticle — write individual {id}.json to Drive
          // Collect SubDeck review state into article, preserving saved flags
          const subs = get().subDecks.filter(sd => sd.parentId === articleId);
          const existingReviews = article.subDeckReviews || [];
          const subDeckReviews = subs.map(sd => {
            const existing = existingReviews.find(r => r.startIndex === sd.startIndex && r.endIndex === sd.endIndex);
            return {
              startIndex: sd.startIndex,
              endIndex: sd.endIndex,
              nextReviewDate: sd.nextReviewDate ? new Date(sd.nextReviewDate).toISOString() : null,
              reviewInterval: sd.reviewInterval || 0,
              lastAccessed: sd.lastAccessed ? new Date(sd.lastAccessed).toISOString() : undefined,
              saved: existing?.saved || false,
            };
          });
          // FullArticle structurally satisfies AudioArticle — safe to pass directly
          await drive.saveArticle({ ...article, subDeckReviews } as AudioArticle);
        }
        // SummaryArticle dirty → index.json sync below handles it (no individual JSON write needed)
      }

      // 3. Sync index.json with current state (single write, all articles)
      const summaries = get().audioArticles.map(toIndexSummary);
      await drive.saveIndex(summaries);

      // 4. Update clean snapshots to current saved state
      const cleanIntervals = new Map(get().cleanAudioIntervals);
      const cleanSnapshots = new Map(get().cleanAudioSnapshots);
      for (const articleId of Array.from(dirtyIds)) {
        const article = get().audioArticles.find(a => a.id === articleId);
        if (article) {
          cleanIntervals.set(articleId, article.reviewInterval || 0);
          cleanSnapshots.set(articleId, snapshotArticle(article));
        }
      }
      set({ dirtyAudioIds: new Set(), cleanAudioIntervals: cleanIntervals, cleanAudioSnapshots: cleanSnapshots });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Drive 저장 실패';
      set({ error: errorMessage });
    } finally {
      set({ isLoading: false });
    }
  },

  // Review actions — local state only, marks dirty (Drive save on explicit "저장")
  markReviewDone: async (type: 'article' | 'audio' | 'subdeck' | 'saved-sentences', id: string) => {
    try {
      if (type === 'audio') {
        const article = get().audioArticles.find(a => a.id === id);
        if (!article) return;
        const interval = article.reviewInterval || 1;
        const next = new Date();
        next.setDate(next.getDate() + interval);
        const updated = { ...article, reviewInterval: interval, nextReviewDate: next, lastAccessed: new Date() };
        set({ audioArticles: get().audioArticles.map(a => a.id === id ? updated : a) });
        checkCleanAndUpdateDirty(get, set, id);
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
      } else if (type === 'saved-sentences') {
        const article = get().audioArticles.find(a => a.id === id);
        if (!article) return;
        const interval = article.savedSentenceReview?.reviewInterval || 1;
        const next = new Date();
        next.setDate(next.getDate() + interval);
        const updated = { ...article, savedSentenceReview: { reviewInterval: interval, nextReviewDate: next.toISOString() } };
        set({ audioArticles: get().audioArticles.map(a => a.id === id ? updated : a) });
        checkCleanAndUpdateDirty(get, set, id);
      } else {
        // SubDeck: local state + mark parent dirty
        const deck = get().subDecks.find(d => d.id === id);
        if (!deck) return;
        const interval = deck.reviewInterval || 1;
        const next = new Date();
        next.setDate(next.getDate() + interval);
        const updated = { ...deck, reviewInterval: interval, nextReviewDate: next, lastAccessed: new Date() };
        set({ subDecks: get().subDecks.map(d => d.id === id ? updated : d) });
        checkCleanAndUpdateDirty(get, set, deck.parentId);
        await localDB.markReviewDone('subdeck', id);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to mark review done';
      set({ error: errorMessage });
    }
  },

  cycleReviewInterval: async (type: 'article' | 'audio' | 'subdeck' | 'saved-sentences', id: string) => {
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
        const updated = { ...article, reviewInterval: newInterval, nextReviewDate, lastAccessed: new Date() };
        set({ audioArticles: get().audioArticles.map(a => a.id === id ? updated : a) });
        checkCleanAndUpdateDirty(get, set, id);
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
      } else if (type === 'saved-sentences') {
        const article = get().audioArticles.find(a => a.id === id);
        if (!article) return;
        const currentInterval = article.savedSentenceReview?.reviewInterval || 0;
        const newInterval = localDB.cycleInterval(currentInterval);
        let nextReviewDate: string | null = null;
        if (newInterval > 0) {
          const d = new Date(); d.setDate(d.getDate() + newInterval);
          nextReviewDate = d.toISOString();
        }
        const updated = { ...article, savedSentenceReview: { reviewInterval: newInterval, nextReviewDate } };
        set({ audioArticles: get().audioArticles.map(a => a.id === id ? updated : a) });
        checkCleanAndUpdateDirty(get, set, id);
      } else {
        // SubDeck: local state + mark parent dirty only if changed from clean
        const deck = get().subDecks.find(d => d.id === id);
        if (!deck) return;
        const newInterval = localDB.cycleInterval(deck.reviewInterval || 0);
        let nextReviewDate: Date | null = null;
        if (newInterval > 0) {
          nextReviewDate = new Date();
          nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);
        }
        const updated = { ...deck, reviewInterval: newInterval, nextReviewDate };
        set({ subDecks: get().subDecks.map(d => d.id === id ? updated : d) });
        // SubDeck review is stored in parent article's subDeckReviews — update snapshot there
        checkCleanAndUpdateDirty(get, set, deck.parentId);
        await localDB.setReviewInterval('subdeck', id, newInterval);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to cycle review interval';
      set({ error: errorMessage });
    }
  },

  updateSavedSentenceIndices: (articleId: string, indices: number[]) => {
    const article = get().audioArticles.find(a => a.id === articleId);
    if (!article) return;
    const updated = { ...article, savedSentenceIndices: indices };
    set({ audioArticles: get().audioArticles.map(a => a.id === articleId ? updated : a) });
    checkCleanAndUpdateDirty(get, set, articleId);
  },

  updateArticleSource: (articleId: string, source: string) => {
    const article = get().audioArticles.find(a => a.id === articleId);
    if (!article) return;
    set({ audioArticles: get().audioArticles.map(a => a.id === articleId ? { ...a, source: source || undefined } : a) });
    checkCleanAndUpdateDirty(get, set, articleId);
  },

  updateArticleSentences: (articleId: string, sentences: SentenceEntry[]) => {
    const article = get().audioArticles.find(a => a.id === articleId);
    if (!article) return;
    set({ audioArticles: get().audioArticles.map(a => a.id === articleId ? { ...a, sentences } : a) });
    checkCleanAndUpdateDirty(get, set, articleId);
  },

  toggleSavedDeck: (articleId: string, subDeckId?: string) => {
    if (subDeckId) {
      // SubDeck
      const aa = get().audioArticles.find(a => a.id === articleId);
      if (!aa) return;
      const sd = get().subDecks.find(s => s.id === subDeckId);
      if (!sd) return;
      const key = `${sd.startIndex}_${sd.endIndex}`;
      const existing = (aa.subDeckReviews || []).find(r => `${r.startIndex}_${r.endIndex}` === key);
      let reviews;
      if (!existing) {
        reviews = [...(aa.subDeckReviews || []), { startIndex: sd.startIndex, endIndex: sd.endIndex, reviewInterval: 0, saved: true }];
      } else {
        reviews = (aa.subDeckReviews || []).map(r =>
          `${r.startIndex}_${r.endIndex}` === key ? { ...r, saved: !r.saved } : r
        );
      }
      const updated = { ...aa, subDeckReviews: reviews };
      set({ audioArticles: get().audioArticles.map(a => a.id === articleId ? updated : a) });
      checkCleanAndUpdateDirty(get, set, articleId);
    } else {
      // AudioArticle
      const aa = get().audioArticles.find(a => a.id === articleId);
      if (!aa) return;
      const updated = { ...aa, savedAsDeck: !aa.savedAsDeck };
      set({ audioArticles: get().audioArticles.map(a => a.id === articleId ? updated : a) });
      checkCleanAndUpdateDirty(get, set, articleId);
    }
  },

  // Type-safe accessor: get FullArticle by id (returns undefined if not loaded)
  getFullArticle: (id: string) => {
    const a = get().audioArticles.find(a => a.id === id);
    return a?.kind === 'loaded' ? a : undefined;
  },

  // Diagnostic: find articles where Drive JSON has empty sentences but index says sentenceCount > 0
  diagnoseCorrupted: async () => {
    const drive = getDriveService(get().accessToken);
    if (!drive) { console.error('No Drive token'); return; }
    console.log('[diagnose] Scanning all Drive JSONs...');
    const corrupted = await drive.diagnoseCorrupted();
    if (corrupted.length === 0) {
      console.log('[diagnose] ✅ No corrupted articles found');
    } else {
      console.warn(`[diagnose] ❌ ${corrupted.length} corrupted articles:`);
      console.table(corrupted);
    }
  },

  // OAuth actions
  setAccessToken: (token: string | null, expiresIn?: number) => {
    if (token) {
      localDB.saveAccessToken(token, expiresIn);
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

// Expose store to browser console for diagnostics
(window as any).__appStore = useAppStore;

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
