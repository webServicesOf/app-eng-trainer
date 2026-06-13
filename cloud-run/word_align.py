"""Whisper-based word-level alignment for sentences.

Takes an MP3 file and sentence list (with start/end timestamps),
runs Whisper with word_timestamps, and maps words to sentences.
"""
import whisper


def align_words(
    mp3_path: str,
    sentences: list[dict],
    model_name: str = "base.en",
) -> list[dict]:
    """Add word-level timestamps to each sentence.

    Each sentence gets a 'words' field: [{"word": str, "start": float, "end": float}].
    Words are assigned to the sentence whose time range contains the word's midpoint.
    """
    model = whisper.load_model(model_name)
    result = model.transcribe(mp3_path, word_timestamps=True, language="en")

    # Collect all whisper words
    all_words = []
    for seg in result["segments"]:
        for w in seg.get("words", []):
            all_words.append({
                "word": w["word"].strip(),
                "start": round(w["start"], 3),
                "end": round(w["end"], 3),
            })

    # Assign each word to exactly one sentence using midpoint
    for sent in sentences:
        sent["words"] = []

    for w in all_words:
        mid = (w["start"] + w["end"]) / 2
        best_sent = None
        best_dist = float("inf")
        for sent in sentences:
            if sent["start"] <= mid <= sent["end"]:
                best_sent = sent
                break
            # Fallback: closest sentence
            dist = min(abs(mid - sent["start"]), abs(mid - sent["end"]))
            if dist < best_dist:
                best_dist = dist
                best_sent = sent

        if best_sent is not None:
            best_sent["words"].append(w)

    return sentences
