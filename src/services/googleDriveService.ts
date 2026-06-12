import { AudioArticle, SentenceEntry } from '../types';

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

export class GoogleDriveService {
  private token: string;
  private folderId: string | null = null;

  constructor(token: string) {
    this.token = token;
  }

  // ── folder management ──────────────────────────────────

  /** Find or create the eng-trainer folder and cache its ID */
  private async ensureFolder(): Promise<string> {
    if (this.folderId) return this.folderId;

    // Search for existing folder
    const q = `name='${getDriveFolderName()}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await driveRequest(
      `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
      this.token,
    );
    const data = await res.json();

    if (data.files && data.files.length > 0) {
      this.folderId = data.files[0].id;
      return this.folderId!;
    }

    // Create folder
    const createRes = await driveRequest(`${DRIVE_API}/files`, this.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: getDriveFolderName(),
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    const folder = await createRes.json();
    this.folderId = folder.id;
    return this.folderId!;
  }

  // ── low-level file ops ─────────────────────────────────

  /** List all files inside the eng-trainer folder */
  private async listFiles(): Promise<{ id: string; name: string; modifiedTime: string }[]> {
    const folderId = await this.ensureFolder();
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
    existingFileId?: string,
  ): Promise<string> {
    const folderId = await this.ensureFolder();

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
    const metadata = JSON.stringify({ name, parents: [folderId] });
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
      source: meta.source,
      nextReviewDate: meta.nextReviewDate ? new Date(meta.nextReviewDate) : null,
      reviewInterval: meta.reviewInterval || 0,
      createdAt: new Date(meta.createdAt),
      lastAccessed: new Date(meta.lastAccessed),
    };
  }

  // ── public CRUD API ────────────────────────────────────

  /** List all audio articles from Drive (metadata only, no blobs) */
  async listArticles(): Promise<AudioArticle[]> {
    const remoteFiles = await this.listFiles();
    const jsonFiles = remoteFiles.filter((f) => f.name.endsWith('.json'));

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
    const remoteFiles = await this.listFiles();
    const jsonFile = remoteFiles.find((f) => f.name === `${id}.json`);
    if (!jsonFile) return null;

    const jsonBlob = await this.downloadFile(jsonFile.id);
    const meta: AudioArticleMeta = JSON.parse(await jsonBlob.text());
    return this.metaToArticle(meta);
  }

  /** Save (upsert) article metadata JSON to Drive */
  async saveArticle(article: AudioArticle): Promise<void> {
    const remoteFiles = await this.listFiles();
    const jsonName = `${article.id}.json`;
    const existing = remoteFiles.find((f) => f.name === jsonName);

    await this.uploadFile(
      jsonName,
      JSON.stringify(this.articleToMeta(article), null, 2),
      'application/json',
      existing?.id,
    );
  }

  /** Upload MP3 blob to Drive (only if not already present) */
  async uploadMp3(id: string, blob: Blob): Promise<void> {
    const remoteFiles = await this.listFiles();
    const mp3Name = `${id}.mp3`;
    const existing = remoteFiles.find((f) => f.name === mp3Name);
    if (existing) return; // already uploaded, skip

    await this.uploadFile(mp3Name, blob, 'audio/mpeg');
  }

  /** Download MP3 blob from Drive */
  async downloadMp3(id: string): Promise<Blob | null> {
    const remoteFiles = await this.listFiles();
    const mp3File = remoteFiles.find((f) => f.name === `${id}.mp3`);
    if (!mp3File) return null;

    return this.downloadFile(mp3File.id);
  }

  // ── Settings sync ────────────────────────────────────

  /** Save app settings to Drive (excludes sensitive keys like TTS API key) */
  async saveSettings(settings: Record<string, any>): Promise<void> {
    const remoteFiles = await this.listFiles();
    const existing = remoteFiles.find((f) => f.name === 'settings.json');
    await this.uploadFile(
      'settings.json',
      JSON.stringify(settings, null, 2),
      'application/json',
      existing?.id,
    );
  }

  /** Load app settings from Drive */
  async loadSettings(): Promise<Record<string, any> | null> {
    const remoteFiles = await this.listFiles();
    const settingsFile = remoteFiles.find((f) => f.name === 'settings.json');
    if (!settingsFile) return null;
    const blob = await this.downloadFile(settingsFile.id);
    return JSON.parse(await blob.text());
  }

  /** Delete article JSON + MP3 from Drive */
  async deleteArticle(id: string): Promise<void> {
    const remoteFiles = await this.listFiles();
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
