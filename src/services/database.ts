import Dexie, { Table } from 'dexie';
import { Article, AudioArticle, SubDeck, GoogleSheetsConfig, SavedSentence } from '../types';

export class AppDatabase extends Dexie {
  // 테이블 정의
  articles!: Table<Article>;
  savedSentences!: Table<SavedSentence>;
  audioArticles!: Table<AudioArticle>;
  subDecks!: Table<SubDeck>;

  constructor() {
    super('EnglishLearningAppDB');

    this.version(4).stores({
      articles: 'id, title, lastAccessed, createdAt',
      savedSentences: 'id, articleId, sentenceIndex, savedAt, [articleId+sentenceIndex]'
    });

    this.version(5).stores({
      articles: 'id, title, lastAccessed, createdAt',
      savedSentences: 'id, articleId, sentenceIndex, savedAt, [articleId+sentenceIndex]',
      audioArticles: 'id, title, lastAccessed, createdAt'
    });

    this.version(6).stores({
      articles: 'id, title, lastAccessed, createdAt, nextReviewDate',
      savedSentences: 'id, articleId, sentenceIndex, savedAt, [articleId+sentenceIndex]',
      audioArticles: 'id, title, lastAccessed, createdAt, nextReviewDate'
    }).upgrade(tx => {
      tx.table('articles').toCollection().modify(article => {
        if (article.nextReviewDate === undefined) {
          article.nextReviewDate = null;
          article.reviewInterval = 0;
        }
      });
      tx.table('audioArticles').toCollection().modify(article => {
        if (article.nextReviewDate === undefined) {
          article.nextReviewDate = null;
          article.reviewInterval = 0;
        }
      });
    });

    this.version(7).stores({
      articles: 'id, title, lastAccessed, createdAt, nextReviewDate',
      savedSentences: 'id, articleId, sentenceIndex, savedAt, [articleId+sentenceIndex]',
      audioArticles: 'id, title, lastAccessed, createdAt, nextReviewDate',
      subDecks: 'id, parentId, title, lastAccessed, nextReviewDate'
    });
  }
}

export const db = new AppDatabase();

// 로컬 데이터베이스 서비스 클래스
export class LocalDatabaseService {

  // Article 관련 메서드
  async getArticles(): Promise<Article[]> {
    return await db.articles.orderBy('lastAccessed').reverse().toArray();
  }

  async getArticleById(id: string): Promise<Article | undefined> {
    return await db.articles.get(id);
  }

  async saveArticle(article: Article): Promise<void> {
    await db.articles.put(article);
  }

  async deleteArticle(id: string): Promise<void> {
    await db.articles.delete(id);
  }

  async updateLastAccessed(id: string): Promise<void> {
    const article = await this.getArticleById(id);
    if (article) {
      article.lastAccessed = new Date();
      await this.saveArticle(article);
    }
  }

  // Google Sheets 설정 관리 (localStorage 활용)
  saveGoogleSheetsConfig(config: GoogleSheetsConfig): void {
    localStorage.setItem('google_sheets_config', JSON.stringify(config));
  }

  getGoogleSheetsConfig(): GoogleSheetsConfig | null {
    const config = localStorage.getItem('google_sheets_config');
    return config ? JSON.parse(config) : null;
  }

  clearGoogleSheetsConfig(): void {
    localStorage.removeItem('google_sheets_config');
  }

  // OAuth 토큰 관리
  saveAccessToken(token: string): void {
    localStorage.setItem('google_oauth_token', token);
  }

  getAccessToken(): string | null {
    return localStorage.getItem('google_oauth_token');
  }

  clearAccessToken(): void {
    localStorage.removeItem('google_oauth_token');
  }

  // 데이터베이스 초기화
  async clearAllData(): Promise<void> {
    await db.articles.clear();
  }

  // SavedSentence 관련 메서드
  async getSavedSentences(): Promise<SavedSentence[]> {
    return await db.savedSentences.orderBy('savedAt').reverse().toArray();
  }

  async saveSentence(sentence: SavedSentence): Promise<void> {
    await db.savedSentences.put(sentence);
  }

  async deleteSavedSentence(id: string): Promise<void> {
    await db.savedSentences.delete(id);
  }

  async isSentenceSaved(articleId: string, sentenceIndex: number): Promise<boolean> {
    const existing = await db.savedSentences
      .where('[articleId+sentenceIndex]')
      .equals([articleId, sentenceIndex])
      .first();
    return !!existing;
  }

  // ── MP3 Blob Cache (IndexedDB) ────────────────────────

  /** Get cached MP3 blob by article ID */
  async getCachedMp3(id: string): Promise<Blob | undefined> {
    const record = await db.audioArticles.get(id);
    return record?.audioBlob;
  }

  /** Cache MP3 blob in IndexedDB */
  async cacheMp3(id: string, blob: Blob): Promise<void> {
    // Store minimal record — just id + blob
    await db.audioArticles.put({
      id,
      audioBlob: blob,
      title: '',
      sentences: [],
      nextReviewDate: null,
      reviewInterval: 0,
      createdAt: new Date(),
      lastAccessed: new Date(),
    } as AudioArticle);
  }

  /** Remove cached MP3 blob */
  async removeCachedMp3(id: string): Promise<void> {
    await db.audioArticles.delete(id);
  }

  // SubDeck methods
  async getSubDecks(): Promise<SubDeck[]> {
    return await db.subDecks.orderBy('lastAccessed').reverse().toArray();
  }

  async getSubDecksByParent(parentId: string): Promise<SubDeck[]> {
    return await db.subDecks.where('parentId').equals(parentId).toArray();
  }

  async saveSubDeck(subDeck: SubDeck): Promise<void> {
    await db.subDecks.put(subDeck);
  }

  async deleteSubDeck(id: string): Promise<void> {
    await db.subDecks.delete(id);
  }

  async deleteSubDecksByParent(parentId: string): Promise<void> {
    await db.subDecks.where('parentId').equals(parentId).delete();
  }

  // Spaced repetition — fixed interval steps
  static readonly REVIEW_INTERVALS = [0, 1, 3, 7, 10, 30, 120];

  /** Set review interval and compute nextReviewDate (for Text articles and SubDecks only) */
  async setReviewInterval(type: 'article' | 'subdeck', id: string, interval: number): Promise<void> {
    let record: any;
    if (type === 'article') record = await this.getArticleById(id);
    else record = await db.subDecks.get(id);
    if (!record) return;

    record.reviewInterval = interval;
    if (interval === 0) {
      record.nextReviewDate = null;
    } else {
      const next = new Date();
      next.setDate(next.getDate() + interval);
      record.nextReviewDate = next;
    }

    if (type === 'article') await this.saveArticle(record);
    else await this.saveSubDeck(record);
  }

  /** Mark review done with current interval setting (for Text articles and SubDecks only) */
  async markReviewDone(type: 'article' | 'subdeck', id: string): Promise<void> {
    let record: any;
    if (type === 'article') record = await this.getArticleById(id);
    else record = await db.subDecks.get(id);
    if (!record) return;
    await this.setReviewInterval(type, id, record.reviewInterval || 1);
  }

  /** Cycle to next interval step */
  cycleInterval(current: number): number {
    const intervals = LocalDatabaseService.REVIEW_INTERVALS;
    const idx = intervals.indexOf(current);
    if (idx === -1 || idx >= intervals.length - 1) return intervals[0];
    return intervals[idx + 1];
  }
}

export const localDB = new LocalDatabaseService();
