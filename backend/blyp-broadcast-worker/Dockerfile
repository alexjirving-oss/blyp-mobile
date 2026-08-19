FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

ARG MEDIAMTX_VERSION=v1.11.3
RUN curl -fsSL "https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz" \
  | tar -xz -C /usr/local/bin mediamtx

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY tsconfig.json mediamtx.yml ./
COPY src ./src
RUN npm install typescript --no-save && npx tsc -p tsconfig.json && npm uninstall typescript

ENV PORT=4100
ENV BROADCAST_WORKER_REGION=eu-west-1
EXPOSE 4100

CMD ["node", "dist/index.js"]
