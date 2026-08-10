import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { env } from "../../config/env";

const PURPUR_API_BASE = process.env.PURPUR_API_BASE ?? "https://api.purpurmc.org/v2/purpur";

/** Fallback si la API de Purpur no está disponible. */
const FALLBACK_VERSIONS = [
  "1.21.8", "1.21.7", "1.21.6", "1.21.5", "1.21.4", "1.21.3",
  "1.21.2", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1"
];

const VERSION_CACHE_TTL_MS = 10 * 60 * 1000;

export class JarManager {
  private versionsCache: { versions: string[]; fetchedAt: number } | null = null;

  /**
   * Lista de versiones de Minecraft disponibles (más recientes primero).
   */
  async listVersions(): Promise<string[]> {
    if (this.versionsCache && Date.now() - this.versionsCache.fetchedAt < VERSION_CACHE_TTL_MS) {
      return this.versionsCache.versions;
    }

    try {
      const response = await fetch(`${PURPUR_API_BASE}/`);
      if (!response.ok) throw new Error(`Purpur API responded ${response.status}`);
      const data = (await response.json()) as { versions?: string[] };
      const versions = (data.versions ?? [])
        .filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v))
        .sort((a, b) => this.compareVersions(b, a));

      if (versions.length === 0) throw new Error("Purpur API returned no versions");

      this.versionsCache = { versions, fetchedAt: Date.now() };
      return versions;
    } catch (error: any) {
      console.error(`[JarManager] Failed to fetch versions from Purpur: ${error.message}`);
      return FALLBACK_VERSIONS;
    }
  }

  /**
   * Devuelve la ruta del jar de Purpur para la versión indicada,
   * descargándolo la primera vez que se pide.
   */
  async resolveJarPath(version: string): Promise<string> {
    const jarPath = path.join(env.minecraftDir, `purpur-${version}.jar`);

    try {
      await fs.access(jarPath);
      return jarPath;
    } catch {
      // No existe: descargar
    }

    const downloadUrl = `${PURPUR_API_BASE}/${encodeURIComponent(version)}/latest/download`;
    console.log(`[JarManager] Downloading Purpur ${version}...`);

    const response = await fetch(downloadUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed ${response.status} ${response.statusText}: ${downloadUrl}`);
    }

    await fs.mkdir(path.dirname(jarPath), { recursive: true });
    // Descargar a un archivo temporal y renombrar al terminar para no dejar jars a medias
    const tempPath = `${jarPath}.tmp`;
    await pipeline(response.body, createWriteStream(tempPath));
    await fs.rename(tempPath, jarPath);

    console.log(`[JarManager] Purpur ${version} downloaded to ${jarPath}`);
    return jarPath;
  }

  /** Compara versiones semánticas "x.y[.z]" de mayor a menor. */
  private compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
}

export const jarManager = new JarManager();
