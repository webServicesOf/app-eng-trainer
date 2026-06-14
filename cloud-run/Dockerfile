FROM python:3.12-slim

# Install ffmpeg + git + curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS (yt-dlp EJS solver needs node)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-install EJS solver cache (avoids GitHub download at runtime)
COPY ejs-solver-cache/lib.json /root/.cache/yt-dlp/challenge-solver/lib.json

# yt-dlp config: enable node runtime + EJS solver
RUN mkdir -p /root/.config/yt-dlp && \
    echo "--js-runtimes node" > /root/.config/yt-dlp/config && \
    echo "--remote-components ejs:github" >> /root/.config/yt-dlp/config

COPY . .

# Cloud Run uses PORT env var (default 8080)
ENV PORT=8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
