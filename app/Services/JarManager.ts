import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { env } from "../../config/env";

const execAsync = promisify(exec);

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
   * Lista de versiones según el motor del servidor:
   *  purpur  → API de Purpur
   *  fabric  → meta.fabricmc.net (versiones estables)
   *  forge   → promociones de Forge (files.minecraftforge.net)
   *  bedrock → siempre la última disponible
   */
  async listVersionsFor(softwareType: string): Promise<string[]> {
    const type = softwareType?.toLowerCase();
    if (type === "fabric") return this.listFabricVersions();
    if (type === "forge") return this.listForgeVersions();
    if (type === "bedrock") return ["latest"];
    return this.listVersions();
  }

  private async listFabricVersions(): Promise<string[]> {
    try {
      const response = await fetch("https://meta.fabricmc.net/v2/versions/game");
      if (!response.ok) throw new Error(`Fabric meta responded ${response.status}`);
      const data = (await response.json()) as { version: string; stable: boolean }[];
      const versions = (data ?? [])
        .filter((v) => v.stable && /^\d+\.\d+(\.\d+)?$/.test(v.version))
        .map((v) => v.version)
        .sort((a, b) => this.compareVersions(b, a));
      if (versions.length === 0) throw new Error("Fabric meta returned no stable versions");
      return versions;
    } catch (error: any) {
      console.error(`[JarManager] Failed to fetch Fabric versions: ${error.message}`);
      return FALLBACK_VERSIONS;
    }
  }

  private async listForgeVersions(): Promise<string[]> {
    try {
      const response = await fetch("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json");
      if (!response.ok) throw new Error(`Forge promos responded ${response.status}`);
      const data = (await response.json()) as { promos?: Record<string, string> };
      const versions = [...new Set(
        Object.keys(data.promos ?? {})
          .map((k) => k.replace(/-(recommended|latest)$/, ""))
          .filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v))
      )].sort((a, b) => this.compareVersions(b, a));
      if (versions.length === 0) throw new Error("Forge promos returned no versions");
      return versions;
    } catch (error: any) {
      console.error(`[JarManager] Failed to fetch Forge versions: ${error.message}`);
      return ["1.21.8", "1.21.7", "1.21.6", "1.21.5", "1.21.4", "1.21.3", "1.21.2", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5", "1.12.2"];
    }
  }

  /**
   * Devuelve la ruta del jar para la versión indicada,
   * descargándolo la primera vez que se pide.
   */
  async resolveJarPath(softwareType: string, version: string, serverDir?: string, logger?: (msg: string) => void): Promise<string> {
    const type = softwareType.toLowerCase();
    
    if (type === "fabric") {
      return this.resolveFabricJar(version, logger);
    } else if (type === "forge") {
      return this.resolveForgeJar(version, serverDir, logger);
    } else if (type === "bedrock") {
      return this.resolveBedrockPath(serverDir, logger);
    } else {
      // Default / Purpur
      return this.resolvePurpurJar(version, logger);
    }
  }

  private log(msg: string, logger?: (msg: string) => void) {
    console.log(`[JarManager] ${msg}`);
    if (logger) logger(msg);
  }

  private async resolvePurpurJar(version: string, logger?: (msg: string) => void): Promise<string> {
    const jarPath = path.join(env.minecraftDir, `purpur-${version}.jar`);

    try {
      await fs.access(jarPath);
      return jarPath;
    } catch {
      // No existe: descargar
    }

    const downloadUrl = `${PURPUR_API_BASE}/${encodeURIComponent(version)}/latest/download`;
    this.log(`Downloading Purpur ${version}...`, logger);

    const response = await fetch(downloadUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed ${response.status} ${response.statusText}: ${downloadUrl}`);
    }

    await fs.mkdir(path.dirname(jarPath), { recursive: true });
    const tempPath = `${jarPath}.tmp`;
    await pipeline(response.body, createWriteStream(tempPath));
    await fs.rename(tempPath, jarPath);

    this.log(`Purpur ${version} downloaded to ${jarPath}`, logger);
    return jarPath;
  }

  private async resolveFabricJar(version: string, logger?: (msg: string) => void): Promise<string> {
    const jarPath = path.join(env.minecraftDir, `fabric-${version}.jar`);
    try {
      await fs.access(jarPath);
      return jarPath;
    } catch {}

    this.log(`Resolving Fabric ${version}...`, logger);
    const loaderRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
    const loaderJson = (await loaderRes.json()) as any[];
    if (!loaderJson || loaderJson.length === 0) throw new Error(`Fabric no soporta la versión ${version}`);
    const loaderVersion = loaderJson[0].loader.version;

    const installerRes = await fetch(`https://meta.fabricmc.net/v2/versions/installer`);
    const installerJson = (await installerRes.json()) as any[];
    const installerVersion = installerJson[0].version;

    const downloadUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${loaderVersion}/${installerVersion}/server/jar`;
    this.log(`Downloading Fabric server ${version} (loader ${loaderVersion}, installer ${installerVersion})...`, logger);

    const response = await fetch(downloadUrl);
    if (!response.ok || !response.body) throw new Error(`Fabric download failed: ${response.statusText}`);

    await fs.mkdir(path.dirname(jarPath), { recursive: true });
    const tempPath = `${jarPath}.tmp`;
    await pipeline(response.body, createWriteStream(tempPath));
    await fs.rename(tempPath, jarPath);
    this.log(`Fabric ${version} downloaded.`, logger);
    return jarPath;
  }

  private async resolveForgeJar(version: string, serverDir?: string, logger?: (msg: string) => void): Promise<string> {
    if (!serverDir) throw new Error("Server directory is required for Forge installation");

    // 1. Obtener la versión de Forge para esta versión de MC
    let forgeVersion = "";
    try {
      const promoRes = await fetch("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json");
      const promos = await promoRes.json() as any;
      forgeVersion = promos.promos[`${version}-recommended`] || promos.promos[`${version}-latest`];
      if (!forgeVersion) {
        // Fallbacks si no hay promo
        if (version === "1.20.1") forgeVersion = "47.3.0";
        else if (version === "1.16.5") forgeVersion = "36.2.39";
        else if (version === "1.12.2") forgeVersion = "14.23.5.2860";
        else throw new Error(`No default Forge version known for ${version}`);
      }
    } catch (e: any) {
      console.warn(`[JarManager] Could not fetch Forge promotions: ${e.message}`);
      if (version === "1.20.1") forgeVersion = "47.3.0";
      else if (version === "1.16.5") forgeVersion = "36.2.39";
      else if (version === "1.12.2") forgeVersion = "14.23.5.2860";
      else throw new Error(`Cannot resolve Forge version for ${version}`);
    }

    // A partir de 1.17, Forge usa args; antes, usa jar universal
    const isLegacy = this.compareVersions(version, "1.17") < 0;

    const winArgsPath = path.join(serverDir, "libraries", "net", "minecraftforge", "forge", `${version}-${forgeVersion}`, "win_args.txt");
    const universalJarPath = path.join(serverDir, `forge-${version}-${forgeVersion}.jar`);

    // Check if already installed
    try {
      if (!isLegacy) {
        await fs.access(winArgsPath);
        return winArgsPath; // Retornamos la ruta al archivo de args
      } else {
        await fs.access(universalJarPath);
        return universalJarPath;
      }
    } catch {
      // Necesitamos instalar
    }

    this.log(`Descargando instalador de Forge para ${version}-${forgeVersion}...`, logger);
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${forgeVersion}/forge-${version}-${forgeVersion}-installer.jar`;
    const installerPath = path.join(serverDir, "forge-installer.jar");
    
    const response = await fetch(installerUrl);
    if (!response.ok || !response.body) throw new Error(`Forge download failed: ${response.statusText}`);
    
    await fs.mkdir(serverDir, { recursive: true });
    await pipeline(response.body, createWriteStream(installerPath));

    this.log(`Ejecutando instalador de Forge... Esto puede tardar varios minutos.`, logger);
    let javaExe = env.javaBin;
    if (this.compareVersions(version, "1.20.5") >= 0) {
      // 21
    } else if (this.compareVersions(version, "1.17") >= 0) {
      if (env.javaBin17) javaExe = env.javaBin17;
    } else {
      if (env.javaBin8) javaExe = env.javaBin8;
    }

    try {
      await execAsync(`"${javaExe}" -jar forge-installer.jar --installServer`, { cwd: serverDir });
    } catch (e: any) {
      throw new Error(`Fallo al instalar Forge: ${e.message}`);
    }

    // Cleanup installer
    await fs.rm(installerPath, { force: true }).catch(() => {});
    await fs.rm(path.join(serverDir, "forge-installer.jar.log"), { force: true }).catch(() => {});
    await fs.rm(path.join(serverDir, "run.bat"), { force: true }).catch(() => {});
    await fs.rm(path.join(serverDir, "run.sh"), { force: true }).catch(() => {});
    // user_jvm_args.txt no lo borramos porque el usuario podría editarlo, aunque nosotros inyectamos args por cmdline

    // Verificar resultado
    try {
      if (!isLegacy) {
        await fs.access(winArgsPath);
        return winArgsPath;
      } else {
        await fs.access(universalJarPath);
        return universalJarPath;
      }
    } catch {
      // Si el universal no se llamó así (a veces el instalador genera forge-1.12.2-xxx-universal.jar)
      if (isLegacy) {
        const universalJarPathAlt = path.join(serverDir, `forge-${version}-${forgeVersion}-universal.jar`);
        try {
          await fs.access(universalJarPathAlt);
          return universalJarPathAlt;
        } catch {
          throw new Error("El instalador de Forge terminó pero no se encontró el archivo resultante.");
        }
      }
      throw new Error("El instalador de Forge terminó pero no se encontró win_args.txt.");
    }
  }

  private async resolveBedrockPath(serverDir?: string, logger?: (msg: string) => void): Promise<string> {
    if (!serverDir) throw new Error("Server directory is required for Bedrock installation");

    const isWindows = process.platform === "win32";
    const exeName = isWindows ? "bedrock_server.exe" : "bedrock_server";
    const exePath = path.join(serverDir, exeName);

    try {
      await fs.access(exePath);
      return exePath;
    } catch {
      // Necesitamos instalar
    }

    this.log(`Resolving latest Bedrock Dedicated Server URL...`, logger);
    let downloadUrl = "";
    
    try {
      // Intentar escrapear la página oficial
      const res = await fetch("https://www.minecraft.net/en-us/download/server/bedrock", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });
      const html = await res.text();
      
      const regex = isWindows 
        ? /https:\/\/minecraft\.azureedge\.net\/bin-win\/bedrock-server-[\d\.]+\.zip/i
        : /https:\/\/minecraft\.azureedge\.net\/bin-linux\/bedrock-server-[\d\.]+\.zip/i;
        
      const match = html.match(regex);
      if (match) {
        downloadUrl = match[0];
      } else {
        throw new Error("No se pudo encontrar la URL en la página oficial.");
      }
    } catch (e: any) {
      this.log(`Fallo al obtener URL oficial (${e.message}), usando fallback...`, logger);
      // Fallback a una versión conocida reciente si falla el scraping
      downloadUrl = isWindows
        ? "https://minecraft.azureedge.net/bin-win/bedrock-server-1.21.2.02.zip"
        : "https://minecraft.azureedge.net/bin-linux/bedrock-server-1.21.2.02.zip";
    }

    this.log(`Downloading Bedrock server from ${downloadUrl}...`, logger);
    const zipPath = path.join(serverDir, "bedrock-server.zip");
    
    const response = await fetch(downloadUrl);
    if (!response.ok || !response.body) throw new Error(`Bedrock download failed: ${response.statusText}`);
    
    await fs.mkdir(serverDir, { recursive: true });
    await pipeline(response.body, createWriteStream(zipPath));

    this.log(`Extracting Bedrock server...`, logger);
    const zip = new AdmZip(zipPath);
    // Extrayendo todo el contenido (sobrescribir si existe, pero respetando los mundos si ya había)
    zip.extractAllTo(serverDir, true);
    
    await fs.rm(zipPath, { force: true }).catch(() => {});
    
    if (!isWindows) {
      // Dar permisos de ejecución en Linux
      try {
        await execAsync(`chmod +x "${exePath}"`);
      } catch (e: any) {
        this.log(`Advertencia al dar permisos de ejecución: ${e.message}`, logger);
      }
    }

    this.log(`Bedrock server installed at ${exePath}`, logger);
    return exePath;
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
