import path from "node:path";
import { config as loadEnv } from "dotenv";

const repoRoot = path.resolve(__dirname, "../../..");

loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env"), override: false });

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }

  return parsed;
}

function resolveFromRepo(value: string | undefined, fallback: string): string {
  return path.resolve(repoRoot, value ?? fallback);
}

function splitArgs(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value.split(" ").map((part) => part.trim()).filter(Boolean);
}

const minecraftDir = resolveFromRepo(process.env.MINECRAFT_DIR, "minecraft/server");

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: numberFromEnv("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  minecraftDir,
  paperJar: resolveFromRepo(process.env.PAPER_JAR, "minecraft/server/paper.jar"),
  javaBin: process.env.JAVA_BIN ?? "java",
  javaArgs: [
    `-Xms${process.env.JAVA_MIN_MEMORY ?? "1G"}`,
    `-Xmx${process.env.JAVA_MAX_MEMORY ?? "2G"}`,
    ...splitArgs(process.env.JAVA_EXTRA_ARGS)
  ],
  logBufferSize: numberFromEnv("LOG_BUFFER_SIZE", 500),
  stopTimeoutMs: numberFromEnv("MINECRAFT_STOP_TIMEOUT_MS", 30_000),
  commandMaxLength: numberFromEnv("MINECRAFT_COMMAND_MAX_LENGTH", 500),
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
  }
};
