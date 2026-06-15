"""Whisper-based transcription: MP3 → sentences with word-level timestamps.

Single function that replaces the old VTT parsing + dedup + word_align pipeline.
Whisper produces both sentence segments and word timestamps in one pass.
"""
import re

import whisper


# Duration / word-count filters
MIN_DUR = 1.0
MAX_DUR = 15.0
MIN_WORDS = 2


def transcribe_audio(
    mp3_path: str,
    model_name: str = "small.en",
) -> list[dict]:
    """Transcribe MP3 and return sentences with word-level timestamps.

    Returns: [{"text": str, "start": float, "end": float, "index": int,
               "words": [{"word": str, "start": float, "end": float}]}]
    """
    model = whisper.load_model(model_name)
    result = model.transcribe(mp3_path, word_timestamps=True, language="en")

    sentences = []
    idx = 0

    for seg in result["segments"]:
        text = seg["text"].strip()
        if not text:
            continue

        start = round(seg["start"], 3)
        end = round(seg["end"], 3)
        dur = end - start
        word_count = len(text.split())

        # Apply filters
        if dur < MIN_DUR or dur > MAX_DUR or word_count < MIN_WORDS:
            continue

        # Clean artifacts
        text = re.sub(r"\[(?:Applause|Music|Laughter)\]\s*", "", text, flags=re.IGNORECASE).strip()
        if not text:
            continue

        idx += 1
        words = [
            {
                "word": w["word"].strip(),
                "start": round(w["start"], 3),
                "end": round(w["end"], 3),
            }
            for w in seg.get("words", [])
            if w["word"].strip()
        ]

        sentences.append({
            "text": text,
            "start": start,
            "end": end,
            "index": idx,
            "words": words,
        })

    return sentences
