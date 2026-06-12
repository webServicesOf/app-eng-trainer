/**
 * YouTube → MP3 + sentences.json via Cloud Run API.
 *
 * Calls POST /convert with YouTube URL + user's Drive OAuth token.
 * Cloud Run downloads audio, parses subtitles, uploads to Drive.
 */

const CLOUD_RUN_URL = process.env.REACT_APP_YT_CONVERT_URL || 'http://localhost:8080';

export interface ConvertResult {
  articleId: string;
  title: string;
  sentenceCount: number;
}

export async function convertYouTubeUrl(
  url: string,
  driveToken: string,
  folderId?: string,
): Promise<ConvertResult> {
  const res = await fetch(`${CLOUD_RUN_URL}/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, driveToken, folderId: folderId || null }),
  });

  if (!res.ok) {
    const body = await res.text();
    let message: string;
    try {
      message = JSON.parse(body).detail || body;
    } catch {
      message = body;
    }
    throw new Error(`변환 실패 (${res.status}): ${message}`);
  }

  return res.json();
}
