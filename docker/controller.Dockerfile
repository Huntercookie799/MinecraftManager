FROM eclipse-temurin:21-jre AS java-base

FROM node:22-bookworm-slim AS build

WORKDIR /app/backend
COPY backend/package*.json ./
# Copiar prisma antes de instalar para que el postinstall genere el cliente
COPY backend/prisma ./prisma
RUN npm install
RUN npx prisma generate

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

# Copiar Java 21 desde la imagen oficial para evitar problemas de repositorios en Debian 12
COPY --from=java-base /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
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
COPY backend/prisma ./prisma
RUN npm install --omit=dev && npx --yes prisma generate

COPY --from=build /app/backend/dist ./dist
COPY backend/public ./public

EXPOSE 3000 25565
CMD ["/app/scripts/start-render.sh"]
