# Blyp social-import worker — container image.
#
# Bundles Node + ffmpeg + yt-dlp so the worker can download and re-host a user's
# own public videos. Local/VM: continuous poller. Cloud Run: request-driven /wake
# with scale-to-zero (min-instances=0, cpu-throttling); set KEEP_POLLING=1 only if
# you intentionally want an always-on poller bill.
#
# Build:  docker build -t blyp-import-worker tools/import
# Run:    docker run -e PROJECT_ID=blyp-master \
#                    -e GOOGLE_APPLICATION_CREDENTIALS=/svc/sa.json \
#                    -v /path/to/service-account.json:/svc/sa.json:ro \
#                    blyp-import-worker

FROM node:20-slim

# yt-dlp (standalone binary needs python3) + ffmpeg for muxing.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
# Worker + shared stagger helpers (required at require()-time).
COPY blyp_import_worker.js publishSchedule.js ./

ENV PROJECT_ID=blyp-master \
    STORAGE_BUCKET=blyp-master.firebasestorage.app \
    POLL_MS=5000 \
    IMPORT_TMP=/tmp/blyp_imports

CMD ["node", "blyp_import_worker.js"]
