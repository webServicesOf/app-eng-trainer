FROM python:3.12-slim

# Install ffmpeg + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS (yt-dlp EJS solver needs node)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download yt-dlp EJS solver component at build time
RUN yt-dlp --js-runtimes node --remote-components ejs:github \
    --skip-download --no-playlist --print "%(id)s" "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>/dev/null || true

COPY . .

# Cloud Run uses PORT env var (default 8080)
ENV PORT=8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
