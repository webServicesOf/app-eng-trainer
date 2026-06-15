"""Cloud Run API: MP3 → transcription with word-level timestamps.

Endpoint: POST /transcribe
Body: MP3 file (multipart upload)
Response: {"sentences": [...], "sentenceCount": N}
"""
import os
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from transcribe import transcribe_audio

app = FastAPI(title="eng-trainer-api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """Accept MP3 upload, run Whisper, return sentences + word timestamps."""
    if not file.filename or not file.filename.lower().endswith(".mp3"):
        raise HTTPException(400, "Only MP3 files accepted")

    tmpdir = tempfile.mkdtemp(prefix="transcribe_")
    try:
        mp3_path = os.path.join(tmpdir, file.filename)
        content = await file.read()
        Path(mp3_path).write_bytes(content)

        model_name = os.environ.get("WHISPER_MODEL", "small.en")
        sentences = transcribe_audio(mp3_path, model_name=model_name)

        if not sentences:
            raise HTTPException(400, "No sentences found in audio")

        return {
            "sentences": sentences,
            "sentenceCount": len(sentences),
        }
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.get("/health")
async def health():
    return {"status": "ok"}
