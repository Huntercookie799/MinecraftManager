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
   * Devuelve la ruta del jar para la versión indicada,
   * descargándolo la primera vez que se pide.
   */
  async resolveJarPath(softwareType: string, version: string, serverDir?: string): Promise<string> {
    const type = softwareType.toLowerCase();
    
    if (type === "fabric") {
      return this.resolveFabricJar(version);
    } else if (type === "forge") {
      return this.resolveForgeJar(version, serverDir);
    } else {
      // Default / Purpur
      return this.resolvePurpurJar(version);
    }
  }

  private async resolvePurpurJar(version: string): Promise<string> {
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
    const tempPath = `${jarPath}.tmp`;
    await pipeline(response.body, createWriteStream(tempPath));
    await fs.rename(tempPath, jarPath);

    console.log(`[JarManager] Purpur ${version} downloaded to ${jarPath}`);
    return jarPath;
  }

  private async resolveFabricJar(version: string): Promise<string> {
    const jarPath = path.join(env.minecraftDir, `fabric-${version}.jar`);
    try {
      await fs.access(jarPath);
      return jarPath;
    } catch {}

    console.log(`[JarManager] Resolving Fabric ${version}...`);
    const loaderRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
    const loaderJson = (await loaderRes.json()) as any[];
    if (!loaderJson || loaderJson.length === 0) throw new Error(`Fabric no soporta la versión ${version}`);
    const loaderVersion = loaderJson[0].loader.version;

    const installerRes = await fetch(`https://meta.fabricmc.net/v2/versions/installer`);
    const installerJson = (await installerRes.json()) as any[];
    const installerVersion = installerJson[0].version;

    const downloadUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${loaderVersion}/${installerVersion}/server/jar`;
    console.log(`[JarManager] Downloading Fabric server ${version} (loader ${loaderVersion}, installer ${installerVersion})...`);

    const response = await fetch(downloadUrl);
    if (!response.ok || !response.body) throw new Error(`Fabric download failed: ${response.statusText}`);

    await fs.mkdir(path.dirname(jarPath), { recursive: true });
    const tempPath = `${jarPath}.tmp`;
    await pipeline(response.body, createWriteStream(tempPath));
    await fs.rename(tempPath, jarPath);
    return jarPath;
  }

  private async resolveForgeJar(version: string, serverDir?: string): Promise<string> {
    // Para simplificar esta validación inicial y mantenernos funcionales, lanzaremos error para Forge.
    // Forge requiere descargar su instalador, extraer librerías, y correr un .bat o .sh
    // Implementaremos esto si Fabric funciona correctamente.
    throw new Error("Forge no está completamente soportado en este momento. Usa Fabric o Purpur.");
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
