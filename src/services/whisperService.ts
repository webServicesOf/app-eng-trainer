/**
 * Cloud Run Whisper transcription service.
 *
 * Sends MP3 file to POST /transcribe, returns sentences with word-level timestamps.
 */

const CLOUD_RUN_URL = process.env.REACT_APP_YT_CONVERT_URL || 'http://localhost:8080';

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface WhisperSentence {
  text: string;
  start: number;
  end: number;
  index: number;
  words: WhisperWord[];
}

export interface TranscribeResult {
  sentences: WhisperSentence[];
  sentenceCount: number;
}

export async function transcribeAudio(mp3File: File): Promise<TranscribeResult> {
  const formData = new FormData();
  formData.append('file', mp3File);

  const res = await fetch(`${CLOUD_RUN_URL}/transcribe`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    let message: string;
    try {
      message = JSON.parse(body).detail || body;
    } catch {
      message = body;
    }
    throw new Error(`Transcribe 실패 (${res.status}): ${message}`);
  }

  return res.json();
}
