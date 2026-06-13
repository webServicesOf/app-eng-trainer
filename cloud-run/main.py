"""Cloud Run API: YouTube URL → MP3 + sentences.json → Google Drive upload.

Endpoint: POST /convert
Body: {"url": "https://...", "driveToken": "ya29...", "folderId": "optional"}
Response: {"articleId": "...", "title": "...", "sentenceCount": N}
"""
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from dedup import dedup_and_split
from word_align import align_words

app = FastAPI(title="yt2csv-api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

# Duration filters (match yt2csv.sh defaults)
MIN_DUR = 1.0
MAX_DUR = 15.0
MIN_WORDS = 2


class ConvertRequest(BaseModel):
    url: str
    driveToken: str
    folderId: str | None = None  # Drive folder ID (optional — uses default eng-trainer)


class ConvertResponse(BaseModel):
    articleId: str
    title: str
    sentenceCount: int


def find_binary(name: str) -> str:
    """Find yt-dlp or ffmpeg binary."""
    path = shutil.which(name)
    if path:
        return path
    raise RuntimeError(f"{name} not found in PATH")


def parse_vtt_cues(vtt_path: str) -> list[tuple[float, float, str]]:
    """Parse VTT file into (start_sec, end_sec, text) tuples."""
    content = Path(vtt_path).read_text(encoding="utf-8", errors="replace")
    blocks = re.split(r"\n\n+", content)

    cues = []
    time_re = re.compile(r"(\d+:)?(\d+):(\d+)[.,](\d+)")

    def to_seconds(m: re.Match) -> float:
        h = int(m.group(1)[:-1]) if m.group(1) else 0
        return h * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000

    prev_text = ""
    for block in blocks:
        lines = block.strip().split("\n")
        timing_line = None
        text_lines = []

        for line in lines:
            if "-->" in line:
                timing_line = line
            elif timing_line and not line.startswith("WEBVTT") and not line.startswith("Kind:") and not line.startswith("Language:"):
                cleaned = re.sub(r"<[^>]*>", "", line).strip()
                if cleaned:
                    text_lines.append(cleaned)

        if not timing_line or not text_lines:
            continue

        times = list(time_re.finditer(timing_line))
        if len(times) < 2:
            continue

        start = to_seconds(times[0])
        end = to_seconds(times[1])
        text = " ".join(text_lines)

        # Basic consecutive dedup
        if text != prev_text:
            cues.append((start, end, text))
            prev_text = text

    return cues


def filter_sentences(
    sentences: list[dict],
) -> list[dict]:
    """Apply duration/word-count filters."""
    kept = []
    for s in sentences:
        dur = s["end"] - s["start"]
        word_count = len(s["text"].split())
        if MIN_DUR <= dur <= MAX_DUR and word_count >= MIN_WORDS:
            kept.append(s)
    return kept


async def upload_to_drive(
    token: str,
    folder_id: str | None,
    filename: str,
    content: bytes,
    mime_type: str,
) -> str:
    """Upload a file to Google Drive. Returns file ID."""
    import json
    from urllib.request import Request, urlopen

    # Resolve folder
    actual_folder = folder_id
    if not actual_folder:
        # Find or create eng-trainer folder
        q = "name='eng-trainer' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        search_url = f"https://www.googleapis.com/drive/v3/files?q={q}&fields=files(id)&spaces=drive"
        req = Request(search_url, headers={"Authorization": f"Bearer {token}"})
        resp = urlopen(req)
        data = json.loads(resp.read())
        if data.get("files"):
            actual_folder = data["files"][0]["id"]
        else:
            # Create folder
            create_body = json.dumps({"name": "eng-trainer", "mimeType": "application/vnd.google-apps.folder"}).encode()
            req = Request(
                "https://www.googleapis.com/drive/v3/files",
                data=create_body,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                method="POST",
            )
            resp = urlopen(req)
            actual_folder = json.loads(resp.read())["id"]

    # Multipart upload
    boundary = "-----yt2csv_boundary"
    metadata = json.dumps({"name": filename, "parents": [actual_folder]})
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n"
        f"--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--".encode()

    req = Request(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/related; boundary={boundary}",
        },
        method="POST",
    )
    resp = urlopen(req)
    return json.loads(resp.read())["id"]


def _yt_base_args() -> list[str]:
    """Common yt-dlp args: JS runtime + cookie/auth handling.

    Cloud Run: no --cookies-from-browser (no local browser).
    Local dev: uses Chrome cookies for bot-bypass.
    Set YT2CSV_COOKIES_FROM env to override (e.g. "chrome", "firefox").
    """
    args = ["--js-runtimes", "node", "--remote-components", "ejs:github"]
    cookies_from = os.environ.get("YT2CSV_COOKIES_FROM", "")
    if cookies_from:
        args += ["--cookies-from-browser", cookies_from]
    return args


def _run_ytdlp(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    """Run yt-dlp with stdin closed (prevents Keychain hang on macOS)."""
    return subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)


@app.post("/convert", response_model=ConvertResponse)
async def convert(req: ConvertRequest):
    yt_dlp = find_binary("yt-dlp")
    ffmpeg = find_binary("ffmpeg")
    yt_base = _yt_base_args()

    tmpdir = tempfile.mkdtemp(prefix="yt2csv_")
    try:
        # 1. Fetch metadata
        meta_result = _run_ytdlp(
            [yt_dlp, *yt_base, "--skip-download", "--no-playlist", "--print", "%(id)s\t%(title)s", req.url],
            timeout=90,
        )
        if meta_result.returncode != 0:
            raise HTTPException(400, f"yt-dlp metadata failed: {meta_result.stderr[:300]}")

        meta_line = meta_result.stdout.strip().split("\n")[0]
        parts = meta_line.split("\t", 1)
        if len(parts) < 2:
            raise HTTPException(400, f"Unexpected metadata format: {meta_line[:100]}")
        video_id, title = parts[0], parts[1]

        # 2. Download audio + subtitles
        _run_ytdlp(
            [yt_dlp, *yt_base, "--no-playlist",
             "-f", "bestaudio", "-x", "--audio-format", "mp3", "--audio-quality", "0",
             "--write-sub", "--sub-lang", "en", "--sub-format", "vtt",
             "--ffmpeg-location", ffmpeg,
             "-o", f"{tmpdir}/%(id)s.%(ext)s", req.url],
            timeout=180,
        )

        mp3_path = f"{tmpdir}/{video_id}.mp3"
        vtt_path = f"{tmpdir}/{video_id}.en.vtt"

        # Auto-sub fallback
        sub_type = "manual"
        if not os.path.exists(vtt_path):
            sub_type = "auto"
            _run_ytdlp(
                [yt_dlp, *yt_base, "--no-playlist", "--skip-download",
                 "--write-auto-sub", "--sub-lang", "en-orig,en", "--sub-format", "vtt",
                 "-o", f"{tmpdir}/%(id)s.%(ext)s", req.url],
                timeout=90,
            )
            # Check en-orig first, then en
            for lang in ["en-orig", "en"]:
                candidate = f"{tmpdir}/{video_id}.{lang}.vtt"
                if os.path.exists(candidate):
                    vtt_path = candidate
                    break

        if not os.path.exists(mp3_path):
            raise HTTPException(500, "MP3 extraction failed")
        if not os.path.exists(vtt_path):
            raise HTTPException(500, "No subtitles found (manual or auto)")

        # 3. Parse VTT → cues → dedup → sentences
        cues = parse_vtt_cues(vtt_path)
        all_sentences = dedup_and_split(cues, sub_type)
        sentences = filter_sentences(all_sentences)

        if not sentences:
            raise HTTPException(400, f"No sentences survived filtering ({len(cues)} raw cues, {len(all_sentences)} after dedup)")

        # Add index
        for i, s in enumerate(sentences):
            s["index"] = i + 1

        # 3.5. Whisper word-level alignment
        try:
            sentences = align_words(mp3_path, sentences)
        except Exception as e:
            # Word alignment is optional — continue without it
            import logging
            logging.warning(f"Whisper word alignment failed, continuing without: {e}")

        # 4. Upload to Drive
        article_id = f"audio-{video_id}"
        import json
        import time

        # Upload MP3
        mp3_bytes = Path(mp3_path).read_bytes()
        await upload_to_drive(req.driveToken, req.folderId, f"{article_id}.mp3", mp3_bytes, "audio/mpeg")

        # Upload metadata JSON (same schema as GoogleDriveService)
        now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        meta_json = json.dumps({
            "id": article_id,
            "title": title,
            "sentences": sentences,
            "source": req.url,
            "nextReviewDate": None,
            "reviewInterval": 0,
            "createdAt": now,
            "lastAccessed": now,
        }, ensure_ascii=False, indent=2)
        await upload_to_drive(req.driveToken, req.folderId, f"{article_id}.json", meta_json.encode(), "application/json")

        return ConvertResponse(
            articleId=article_id,
            title=title,
            sentenceCount=len(sentences),
        )

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.get("/health")
async def health():
    return {"status": "ok"}
