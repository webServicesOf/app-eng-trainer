FROM python:3.12-slim

# Install ffmpeg + node (yt-dlp EJS solver needs node)
# ffmpeg (audio processing), nodejs (yt-dlp EJS solver), git (whisper install)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nodejs git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run uses PORT env var (default 8080)
ENV PORT=8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
