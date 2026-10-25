# Doorway on Railway: the viewer plus the room builder (ffmpeg, headless Chromium, the orchestrator CLIs) in one container.
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg chromium fonts-liberation ca-certificates libgl1 libegl1 libgles2 \
 && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/viewer ./apps/viewer
COPY scripts ./scripts
COPY assets ./assets
COPY fixtures ./fixtures
RUN npm ci
# The orchestrator CLIs read ../../.env; real settings come from Railway's environment.
RUN touch .env && npm run build -w @doorway/viewer
# Rooms live on a volume mounted at /app/runs; the built-in demo rooms are copied in on first boot.
COPY runs /app/runs-seed
COPY scripts/railway-start.sh /app/start.sh
RUN chmod +x /app/start.sh
ENV NODE_ENV=production
EXPOSE 8080
CMD ["/app/start.sh"]
