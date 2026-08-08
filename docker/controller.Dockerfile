FROM node:22-bookworm-slim AS build

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-21-jre-headless ca-certificates curl \
  && curl -L -o /usr/local/bin/playit https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-linux-amd64 \
  && chmod +x /usr/local/bin/playit \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  PORT=3000 \
  HOST=0.0.0.0 \
  MINECRAFT_DIR=/minecraft/server \
  PAPER_JAR=/minecraft/server/paper.jar

WORKDIR /app
COPY scripts ./scripts
RUN chmod +x ./scripts/start-render.sh

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev

COPY --from=build /app/backend/dist ./dist

EXPOSE 3000 25565
CMD ["/app/scripts/start-render.sh"]
