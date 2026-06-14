FROM python:3.12-slim

# Install ffmpeg + git + curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS (yt-dlp EJS solver needs node)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install standalone yt-dlp binary (NOT pip — pip version misses EJS support)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp && \
    yt-dlp --version

COPY requirements.txt .
# Install Python deps WITHOUT yt-dlp (using standalone binary instead)
RUN grep -v yt-dlp requirements.txt | pip install --no-cache-dir -r /dev/stdin

# Pre-install EJS solver cache
COPY ejs-solver-cache/lib.json /root/.cache/yt-dlp/challenge-solver/lib.json

# yt-dlp config
RUN mkdir -p /root/.config/yt-dlp && \
    printf '%s\n' \
      "--js-runtimes node" \
      "--remote-components ejs:github" \
    > /root/.config/yt-dlp/config

COPY . .

ENV PORT=8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
