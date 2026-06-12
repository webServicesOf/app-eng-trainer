import { AudioArticle, SentenceEntry } from '../types';
import { db } from './database';

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
  async listFiles(): Promise<{ id: string; name: string; modifiedTime: string }[]> {
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
  async uploadFile(
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
  async downloadFile(fileId: string): Promise<Blob> {
    const res = await driveRequest(
      `${DRIVE_API}/files/${fileId}?alt=media`,
      this.token,
    );
    return res.blob();
  }

  /** Delete files that don't match id-based naming (cleanup after title-based migration) */
  async cleanupNonIdFiles(): Promise<number> {
    const files = await this.listFiles();
    const localArticles = await db.audioArticles.toArray();
    const validIds = new Set(localArticles.map(a => a.id));
    let deleted = 0;

    for (const file of files) {
      const baseName = file.name.replace(/\.(json|mp3)$/, '');
      if (validIds.has(baseName)) continue; // id-based, keep
      // Not an id-based file → delete
      try {
        await driveRequest(`${DRIVE_API}/files/${file.id}`, this.token, { method: 'DELETE' });
        deleted++;
      } catch { /* ignore */ }
    }
    return deleted;
  }

  // ── sync logic ─────────────────────────────────────────

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

  /** Upload a single article to Drive (called immediately after local save) */
  async uploadArticle(article: AudioArticle): Promise<void> {
    const remoteFiles = await this.listFiles();
    const remoteMap = new Map(remoteFiles.map((f) => [f.name, f]));

    const jsonName = `${article.id}.json`;
    const mp3Name = `${article.id}.mp3`;
    const remoteJson = remoteMap.get(jsonName);

    // Always upload JSON (local just saved = always newest)
    await this.uploadFile(
      jsonName,
      JSON.stringify(this.articleToMeta(article), null, 2),
      'application/json',
      remoteJson?.id,
    );

    // Upload MP3 only if missing on remote
    const remoteMp3 = remoteMap.get(mp3Name);
    if (!remoteMp3 && article.audioBlob) {
      await this.uploadFile(mp3Name, article.audioBlob, 'audio/mpeg');
    }
  }

  /** Upload all local audioArticles to Drive */
  async syncUp(): Promise<{ uploaded: number }> {
    const localArticles = await db.audioArticles.toArray();
    let uploaded = 0;
    for (const article of localArticles) {
      await this.uploadArticle(article);
      uploaded++;
    }
    return { uploaded };
  }

  /** Download remote audioArticles that are NOT in local (new from other devices only) */
  async syncDown(): Promise<{ downloaded: number; skipped: number }> {
    const remoteFiles = await this.listFiles();

    const jsonFiles = remoteFiles.filter((f) => f.name.endsWith('.json'));
    const mp3Map = new Map(
      remoteFiles
        .filter((f) => f.name.endsWith('.mp3'))
        .map((f) => [f.name.replace('.mp3', ''), f]),
    );

    let downloaded = 0;
    let skipped = 0;

    for (const jsonFile of jsonFiles) {
      const articleId = jsonFile.name.replace('.json', '');

      // Skip if already exists locally (local always wins)
      const local = await db.audioArticles.get(articleId);
      if (local) {
        skipped++;
        continue;
      }

      const jsonBlob = await this.downloadFile(jsonFile.id);
      const meta: AudioArticleMeta = JSON.parse(await jsonBlob.text());

      let audioBlob: Blob | undefined;
      const remoteMp3 = mp3Map.get(articleId);
      if (remoteMp3) {
        audioBlob = await this.downloadFile(remoteMp3.id);
      }

      const audioArticle: AudioArticle = {
        id: meta.id,
        title: meta.title,
        sentences: meta.sentences,
        splitPoints: meta.splitPoints,
        source: meta.source,
        audioBlob,
        nextReviewDate: meta.nextReviewDate ? new Date(meta.nextReviewDate) : null,
        reviewInterval: meta.reviewInterval || 0,
        createdAt: new Date(meta.createdAt),
        lastAccessed: new Date(meta.lastAccessed),
      };

      await db.audioArticles.put(audioArticle);

      // Reconstruct SubDecks from splitPoints
      if (meta.splitPoints?.length) {
        await db.subDecks.where('parentId').equals(meta.id).delete();
        const sorted = [...meta.splitPoints].sort((a, b) => a - b);
        let prev = 0;
        for (let i = 0; i <= sorted.length; i++) {
          const end = i < sorted.length ? sorted[i] + 1 : meta.sentences.length;
          await db.subDecks.put({
            id: `${meta.id}_${prev}_${end}_${Date.now()}_${i}`,
            parentId: meta.id,
            title: `${meta.title} Part ${i + 1}`,
            startIndex: prev,
            endIndex: end,
            nextReviewDate: null,
            reviewInterval: 0,
            createdAt: new Date(),
            lastAccessed: new Date(),
          });
          prev = end;
        }
      }

      downloaded++;
    }

    return { downloaded, skipped };
  }
}
