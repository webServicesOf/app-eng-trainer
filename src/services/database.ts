import Dexie, { Table } from 'dexie';
import { Article, GoogleSheetsConfig, SavedSentence } from '../types';

export class AppDatabase extends Dexie {
  // 테이블 정의
  articles!: Table<Article>;
  savedSentences!: Table<SavedSentence>;

  constructor() {
    super('EnglishLearningAppDB');

    this.version(4).stores({
      articles: 'id, title, lastAccessed, createdAt',
      savedSentences: 'id, articleId, sentenceIndex, savedAt, [articleId+sentenceIndex]'
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
}

export const localDB = new LocalDatabaseService();
