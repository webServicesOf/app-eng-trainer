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

  // ── sync logic ─────────────────────────────────────────

  /** Upload all local audioArticles to Drive (create / update) */
  async syncUp(): Promise<{ uploaded: number; skipped: number }> {
    const remoteFiles = await this.listFiles();
    const remoteMap = new Map(remoteFiles.map((f) => [f.name, f]));

    const localArticles = await db.audioArticles.toArray();
    let uploaded = 0;
    let skipped = 0;

    for (const article of localArticles) {
      const safeName = article.title.replace(/[/\\:*?"<>|]/g, '-');
      const jsonName = `${safeName}.json`;
      const mp3Name = `${safeName}.mp3`;

      const meta: AudioArticleMeta = {
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

      const remoteJson = remoteMap.get(jsonName);

      // Compare timestamps — upload if local is newer or remote doesn't exist
      if (remoteJson) {
        const remoteTime = new Date(remoteJson.modifiedTime).getTime();
        const localTime = new Date(article.lastAccessed).getTime();
        if (localTime <= remoteTime) {
          skipped++;
          continue;
        }
      }

      // Upload JSON metadata
      await this.uploadFile(
        jsonName,
        JSON.stringify(meta, null, 2),
        'application/json',
        remoteJson?.id,
      );

      // Upload MP3 only if missing on remote (MP3 doesn't change, only JSON does)
      const remoteMp3 = remoteMap.get(mp3Name);
      if (!remoteMp3 && article.audioBlob) {
        await this.uploadFile(
          mp3Name,
          article.audioBlob,
          'audio/mpeg',
        );
      }

      uploaded++;
    }

    return { uploaded, skipped };
  }

  /** Download remote audioArticles that are missing or newer locally */
  async syncDown(): Promise<{ downloaded: number; skipped: number }> {
    const remoteFiles = await this.listFiles();

    const jsonFiles = remoteFiles.filter((f) => f.name.endsWith('.json'));
    // Map mp3 files by base name (without .mp3)
    const mp3Map = new Map(
      remoteFiles
        .filter((f) => f.name.endsWith('.mp3'))
        .map((f) => [f.name.replace('.mp3', ''), f]),
    );

    let downloaded = 0;
    let skipped = 0;

    for (const jsonFile of jsonFiles) {
      // Download JSON first to get the real article ID
      const jsonBlob = await this.downloadFile(jsonFile.id);
      const meta: AudioArticleMeta = JSON.parse(await jsonBlob.text());

      // Check local by ID (not filename)
      const local = await db.audioArticles.get(meta.id);
      if (local) {
        const remoteTime = new Date(jsonFile.modifiedTime).getTime();
        const localTime = new Date(local.lastAccessed).getTime();
        if (localTime >= remoteTime) {
          skipped++;
          continue;
        }
      }

      // Download MP3 — match by same base name as JSON
      let audioBlob: Blob | undefined;
      const baseName = jsonFile.name.replace('.json', '');
      const remoteMp3 = mp3Map.get(baseName);
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
