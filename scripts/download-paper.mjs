import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const minecraftVersion = process.env.MINECRAFT_VERSION ?? "1.21.8";
const requestedBuild = process.env.PAPER_BUILD ?? "latest";
const serverDir = path.resolve(repoRoot, process.env.MINECRAFT_DIR ?? "minecraft/server");
const targetJar = path.resolve(repoRoot, process.env.PAPER_JAR ?? "minecraft/server/paper.jar");

async function getJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${response.statusText}: ${url}`);
  }

  return response.json();
}

async function main() {
  await mkdir(serverDir, { recursive: true });

  const downloadUrl = `https://api.purpurmc.org/v2/purpur/${minecraftVersion}/latest/download`;
  console.log(`Downloading Purpur for Minecraft ${minecraftVersion}...`);
  
  const response = await fetch(downloadUrl);

  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status} ${response.statusText}: ${downloadUrl}`);
  }

  await mkdir(path.dirname(targetJar), { recursive: true });
  await pipeline(response.body, fs.createWriteStream(targetJar));

  console.log(`Downloaded successfully to ${targetJar}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
