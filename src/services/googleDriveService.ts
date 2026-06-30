import { AudioArticle, ArticleSummary, SentenceEntry, SubDeckReview } from '../types';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
function getDriveFolderName(): string {
  return localStorage.getItem('drive_folder_name') || 'eng-trainer';
}

/** Metadata-only JSON stored alongside each MP3 in Drive */
interface AudioArticleMeta {
  id: string;
  title: string;
  sentences: SentenceEntry[];
  splitPoints?: number[];
  subDeckReviews?: SubDeckReview[];
  savedAsDeck?: boolean;
  savedSentenceIndices?: number[];
  savedSentenceReview?: { reviewInterval: number; nextReviewDate: string | null };
  source?: string;
  nextReviewDate?: string | null;
  reviewInterval?: number;
  createdAt: string;
  lastAccessed: string;
}

class DriveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

async function driveRequest(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      throw new DriveAuthError('토큰 만료 — 재로그인 필요');
    }
    throw new Error(`Drive API ${res.status}: ${body}`);
  }
  return res;
}

export { DriveAuthError };

/**
 * Drive folder layout:
 *   eng-trainer/          ← root
 *   ├── data/             ← article .json + .mp3
 *   │   ├── audio-xxx.json
 *   │   └── audio-xxx.mp3
 *   └── sys/              ← settings.json
 *       └── settings.json
 */
export class GoogleDriveService {
  private token: string;
  private rootId: string | null = null;
  private dataFolderId: string | null = null;
  private sysFolderId: string | null = null;

  constructor(token: string) {
    this.token = token;
  }

  // ── folder management ──────────────────────────────────

  /** Find or create a folder by name under a parent. */
  private async findOrCreateFolder(name: string, parentId?: string): Promise<string> {
    const parentClause = parentId ? ` and '${parentId}' in parents` : '';
    const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`;
    const res = await driveRequest(
      `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
      this.token,
    );
    const data = await res.json();

    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }

    // Create folder
    const body: Record<string, any> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) body.parents = [parentId];

    const createRes = await driveRequest(`${DRIVE_API}/files`, this.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const folder = await createRes.json();
    return folder.id;
  }

  /** Ensure root + data + sys folders exist. */
  private async ensureFolders(): Promise<{ root: string; data: string; sys: string }> {
    if (this.rootId && this.dataFolderId && this.sysFolderId) {
      return { root: this.rootId, data: this.dataFolderId, sys: this.sysFolderId };
    }

    this.rootId = await this.findOrCreateFolder(getDriveFolderName());
    this.dataFolderId = await this.findOrCreateFolder('data', this.rootId);
    this.sysFolderId = await this.findOrCreateFolder('sys', this.rootId);

    return { root: this.rootId, data: this.dataFolderId, sys: this.sysFolderId };
  }

  // ── low-level file ops ─────────────────────────────────

  /** List all files inside a specific folder */
  private async listFilesIn(folderId: string): Promise<{ id: string; name: string; modifiedTime: string }[]> {
    const q = `'${folderId}' in parents and trashed=false`;
    const fields = 'files(id,name,modifiedTime)';
    const res = await driveRequest(
      `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=1000&spaces=drive`,
      this.token,
    );
    const data = await res.json();
    return data.files || [];
  }

  /** Upload (create or update) a file. Returns the Drive file ID. */
  private async uploadFile(
    name: string,
    content: Blob | string,
    mimeType: string,
    parentFolderId: string,
    existingFileId?: string,
  ): Promise<string> {
    if (existingFileId) {
      // Update existing file content (PATCH)
      const res = await driveRequest(
        `${UPLOAD_API}/files/${existingFileId}?uploadType=media`,
        this.token,
        {
          method: 'PATCH',
          headers: { 'Content-Type': mimeType },
          body: content,
        },
      );
      const data = await res.json();
      return data.id;
    }

    // Create new file via multipart upload
    const metadata = JSON.stringify({ name, parents: [parentFolderId] });
    const boundary = '-----eng_trainer_boundary';
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const ending = `\r\n--${boundary}--`;

    const contentBlob = typeof content === 'string' ? new Blob([content]) : content;
    const fullBody = new Blob(
      [body, contentBlob, ending],
      { type: `multipart/related; boundary=${boundary}` },
    );

    const res = await driveRequest(
      `${UPLOAD_API}/files?uploadType=multipart`,
      this.token,
      {
        method: 'POST',
        body: fullBody,
      },
    );
    const data = await res.json();
    return data.id;
  }

  /** Download file content as a Blob */
  private async downloadFile(fileId: string): Promise<Blob> {
    const res = await driveRequest(
      `${DRIVE_API}/files/${fileId}?alt=media`,
      this.token,
    );
    return res.blob();
  }

  /** Delete a file by Drive file ID */
  private async deleteDriveFile(fileId: string): Promise<void> {
    await driveRequest(`${DRIVE_API}/files/${fileId}`, this.token, { method: 'DELETE' });
  }

  // ── helpers ────────────────────────────────────────────

  private articleToMeta(article: AudioArticle): AudioArticleMeta {
    return {
      id: article.id,
      title: article.title,
      sentences: article.sentences,
      splitPoints: article.splitPoints,
      subDeckReviews: article.subDeckReviews,
      savedAsDeck: article.savedAsDeck,
      savedSentenceIndices: article.savedSentenceIndices,
      savedSentenceReview: article.savedSentenceReview,
      source: article.source,
      nextReviewDate: article.nextReviewDate ? new Date(article.nextReviewDate).toISOString() : null,
      reviewInterval: article.reviewInterval || 0,
      createdAt: new Date(article.createdAt).toISOString(),
      lastAccessed: new Date(article.lastAccessed).toISOString(),
    };
  }

  private metaToArticle(meta: AudioArticleMeta): AudioArticle {
    return {
      id: meta.id,
      title: meta.title,
      sentences: meta.sentences || [],
      splitPoints: meta.splitPoints,
      subDeckReviews: meta.subDeckReviews,
      savedAsDeck: meta.savedAsDeck,
      savedSentenceIndices: meta.savedSentenceIndices,
      savedSentenceReview: meta.savedSentenceReview,
      source: meta.source,
      nextReviewDate: meta.nextReviewDate ? new Date(meta.nextReviewDate) : null,
      reviewInterval: meta.reviewInterval || 0,
      createdAt: new Date(meta.createdAt),
      lastAccessed: new Date(meta.lastAccessed),
    };
  }

  // ── migration: move legacy flat files into data/ ───────

  /** One-time migration: move article files from root to data/ folder */
  private async migrateIfNeeded(): Promise<void> {
    const { root, data } = await this.ensureFolders();
    const rootFiles = await this.listFilesIn(root);

    // Find article files still in root (audio-*.json, audio-*.mp3)
    const articleFiles = rootFiles.filter(f =>
      (f.name.startsWith('audio-') && (f.name.endsWith('.json') || f.name.endsWith('.mp3')))
    );

    if (articleFiles.length === 0) return;

    // Move each file: update parent from root → data
    for (const file of articleFiles) {
      try {
        await driveRequest(
          `${DRIVE_API}/files/${file.id}?addParents=${data}&removeParents=${root}`,
          this.token,
          { method: 'PATCH' },
        );
      } catch (e) {
        console.warn(`Migration: failed to move ${file.name}:`, e);
      }
    }

    // Also move settings.json to sys/ if it's in root
    const { sys } = await this.ensureFolders();
    const settingsInRoot = rootFiles.find(f => f.name === 'settings.json');
    if (settingsInRoot) {
      try {
        await driveRequest(
          `${DRIVE_API}/files/${settingsInRoot.id}?addParents=${sys}&removeParents=${root}`,
          this.token,
          { method: 'PATCH' },
        );
      } catch (e) {
        console.warn('Migration: failed to move settings.json:', e);
      }
    }
  }

  // ── public CRUD API ────────────────────────────────────

  /** List all audio articles from Drive (metadata only, no blobs) */
  async listArticles(): Promise<AudioArticle[]> {
    await this.migrateIfNeeded();
    const { data } = await this.ensureFolders();
    const remoteFiles = await this.listFilesIn(data);
    const jsonFiles = remoteFiles.filter((f) => f.name.endsWith('.json') && f.name !== 'index.json');

    const articles: AudioArticle[] = [];
    for (const jsonFile of jsonFiles) {
      try {
        const jsonBlob = await this.downloadFile(jsonFile.id);
        const meta: AudioArticleMeta = JSON.parse(await jsonBlob.text());
        articles.push(this.metaToArticle(meta));
      } catch (e) {
        console.warn(`Failed to parse ${jsonFile.name}:`, e);
      }
    }

    // Sort by lastAccessed descending
    articles.sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime());
    return articles;
  }

  /** Get a single article's metadata from Drive */
  async getArticle(id: string): Promise<AudioArticle | null> {
    const { data } = await this.ensureFolders();
    const remoteFiles = await this.listFilesIn(data);
    const jsonFile = remoteFiles.find((f) => f.name === `${id}.json`);
    if (!jsonFile) return null;

    const jsonBlob = await this.downloadFile(jsonFile.id);
    const meta: AudioArticleMeta = JSON.parse(await jsonBlob.text());
    return this.metaToArticle(meta);
  }

  /** Save (upsert) article metadata JSON to Drive */
  async saveArticle(article: AudioArticle): Promise<void> {
    const { data } = await this.ensureFolders();
    const remoteFiles = await this.listFilesIn(data);
    const jsonName = `${article.id}.json`;
    const existing = remoteFiles.find((f) => f.name === jsonName);

    await this.uploadFile(
      jsonName,
      JSON.stringify(this.articleToMeta(article), null, 2),
      'application/json',
      data,
      existing?.id,
    );
  }

  /** Upload MP3 blob to Drive (only if not already present) */
  async uploadMp3(id: string, blob: Blob): Promise<void> {
    const { data } = await this.ensureFolders();
    const remoteFiles = await this.listFilesIn(data);
    const mp3Name = `${id}.mp3`;
    const existing = remoteFiles.find((f) => f.name === mp3Name);
    if (existing) return; // already uploaded, skip

    await this.uploadFile(mp3Name, blob, 'audio/mpeg', data);
  }

  /** Download MP3 blob from Drive */
  async downloadMp3(id: string): Promise<Blob | null> {
    const { data } = await this.ensureFolders();
    const remoteFiles = await this.listFilesIn(data);
    const mp3File = remoteFiles.find((f) => f.name === `${id}.mp3`);
    if (!mp3File) return null;

    return this.downloadFile(mp3File.id);
  }

  // ── Settings sync ────────────────────────────────────

  /** Save app settings to Drive sys/ folder */
  async saveSettings(settings: Record<string, any>): Promise<void> {
    const { sys } = await this.ensureFolders();
    const remoteFiles = await this.listFilesIn(sys);
    const existing = remoteFiles.find((f) => f.name === 'settings.json');
    await this.uploadFile(
      'settings.json',
      JSON.stringify(settings, null, 2),
      'application/json',
      sys,
      existing?.id,
    );
  }

  /** Load app settings from Drive sys/ folder */
  async loadSettings(): Promise<Record<string, any> | null> {
    const { sys } = await this.ensureFolders();
    const remoteFiles = await this.listFilesIn(sys);
    const settingsFile = remoteFiles.find((f) => f.name === 'settings.json');
    if (!settingsFile) return null;
    const blob = await this.downloadFile(settingsFile.id);
    return JSON.parse(await blob.text());
  }

  // ── index.json manifest ─────────────────────────────

  /** Build summary from an AudioArticle */
  private articleToSummary(article: AudioArticle): ArticleSummary {
    return {
      id: article.id,
      title: article.title,
      reviewInterval: article.reviewInterval || 0,
      nextReviewDate: article.nextReviewDate ? new Date(article.nextReviewDate).toISOString() : null,
      sentenceCount: article.sentenceCount ?? article.sentences.length,
      savedAsDeck: article.savedAsDeck,
      savedSentenceIndices: article.savedSentenceIndices,
      savedSentenceReview: article.savedSentenceReview,
      subDeckReviews: article.subDeckReviews,
      splitPoints: article.splitPoints,
      source: article.source,
      createdAt: new Date(article.createdAt).toISOString(),
      lastAccessed: new Date(article.lastAccessed).toISOString(),
    };
  }

  /** Load index.json from data/ folder. Returns null if missing or corrupt. */
  async loadIndex(): Promise<ArticleSummary[] | null> {
    const { data } = await this.ensureFolders();
    const files = await this.listFilesIn(data);
    const indexFile = files.find(f => f.name === 'index.json');
    if (!indexFile) return null;
    try {
      const blob = await this.downloadFile(indexFile.id);
      const parsed = JSON.parse(await blob.text());
      return parsed.articles || null;
    } catch {
      return null;
    }
  }

  /** Save index.json to data/ folder */
  private async saveIndex(summaries: ArticleSummary[]): Promise<void> {
    const { data } = await this.ensureFolders();
    const files = await this.listFilesIn(data);
    const indexFile = files.find(f => f.name === 'index.json');
    await this.uploadFile(
      'index.json',
      JSON.stringify({ articles: summaries }, null, 2),
      'application/json',
      data,
      indexFile?.id,
    );
  }

  /** Upsert a single article's summary into index.json */
  async updateIndex(article: AudioArticle): Promise<void> {
    const summaries = await this.loadIndex() || [];
    const summary = this.articleToSummary(article);
    const idx = summaries.findIndex(s => s.id === article.id);
    if (idx >= 0) {
      summaries[idx] = summary;
    } else {
      summaries.push(summary);
    }
    await this.saveIndex(summaries);
  }

  /** Sync index.json from full article list (batch — one write) */
  async syncIndex(articles: AudioArticle[]): Promise<void> {
    // Preserve existing index entries for summary-only articles (sentences=[])
    const existing = await this.loadIndex() || [];
    const existingMap = new Map(existing.map(s => [s.id, s]));

    const summaries = articles.map(a => {
      const summary = this.articleToSummary(a);
      // If article has no sentences loaded (summary-only), preserve existing sentenceCount
      if (a.sentences.length === 0 && existingMap.has(a.id)) {
        const prev = existingMap.get(a.id)!;
        summary.sentenceCount = prev.sentenceCount;
      }
      return summary;
    });
    await this.saveIndex(summaries);
  }

  /** Rebuild index from all individual JSON files (self-healing fallback) */
  async rebuildIndex(): Promise<AudioArticle[]> {
    await this.migrateIfNeeded();
    const { data } = await this.ensureFolders();
    const remoteFiles = await this.listFilesIn(data);
    const jsonFiles = remoteFiles.filter(f => f.name.endsWith('.json') && f.name !== 'index.json');

    const articles: AudioArticle[] = [];
    for (const jsonFile of jsonFiles) {
      try {
        const jsonBlob = await this.downloadFile(jsonFile.id);
        const meta: AudioArticleMeta = JSON.parse(await jsonBlob.text());
        articles.push(this.metaToArticle(meta));
      } catch (e) {
        console.warn(`rebuildIndex: failed to parse ${jsonFile.name}:`, e);
      }
    }

    const summaries = articles.map(a => this.articleToSummary(a));
    await this.saveIndex(summaries);

    articles.sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime());
    return articles;
  }

  /** Delete article JSON + MP3 from Drive data/ folder */
  async deleteArticle(id: string): Promise<void> {
    const { data } = await this.ensureFolders();
    const remoteFiles = await this.listFilesIn(data);
    const jsonFile = remoteFiles.find((f) => f.name === `${id}.json`);
    const mp3File = remoteFiles.find((f) => f.name === `${id}.mp3`);

    if (jsonFile) {
      try { await this.deleteDriveFile(jsonFile.id); } catch { /* ignore */ }
    }
    if (mp3File) {
      try { await this.deleteDriveFile(mp3File.id); } catch { /* ignore */ }
    }
  }
}
