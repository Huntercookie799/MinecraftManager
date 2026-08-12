import { modrinthService, type ModrinthProject, type ModrinthVersion } from "./ModrinthService";
import { curseForgeService, type CurseForgeProject, type CurseForgeFile } from "./CurseForgeService";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";

export interface AddonResult {
  id: string; // Project ID
  source: "modrinth" | "curseforge";
  name: string;
  description: string;
  iconUrl?: string;
  downloads: number;
  categories: string[];
  versions?: string[];
}

export interface AddonVersionResult {
  id: string;
  name: string;
  version: string;
  downloadUrl: string;
  filename: string;
  size: number;
}

export class AddonSearchService {
  /**
   * Busca addons en Modrinth y CurseForge y devuelve una lista combinada.
   */
  async search(query: string, gameVersion?: string, loader?: string, limit = 20, type?: string, category?: string): Promise<AddonResult[]> {
    // Para simplificar, dividimos el límite a la mitad para cada proveedor
    const halfLimit = Math.max(1, Math.floor(limit / 2));

    // Para modpacks el loader del servidor no aplica: los packs usan su propio
    // loader (Fabric/Forge/NeoForge) y filtrar por el del server (p. ej. paper)
    // los excluiría a todos. La versión sí se respeta.
    const effectiveLoader = type === "modpack" ? undefined : loader;

    const [modrinthResults, curseForgeResultsRaw] = await Promise.all([
      modrinthService.search(query, gameVersion, effectiveLoader, halfLimit, type, category),
      curseForgeService.search(query, gameVersion, effectiveLoader, halfLimit, type)
    ]);

    const curseForgeResults = category 
      ? curseForgeResultsRaw.filter(p => p.categories.some(c => c.name.toLowerCase().includes(category.toLowerCase())))
      : curseForgeResultsRaw;

    const combined: AddonResult[] = [];

    // Mapear Modrinth
    for (const project of modrinthResults) {
      combined.push({
        id: project.project_id,
        source: "modrinth",
        name: project.title,
        description: project.description,
        iconUrl: project.icon_url,
        downloads: project.downloads,
        categories: project.categories,
        versions: project.versions
      });
    }

    // Mapear CurseForge
    for (const project of curseForgeResults) {
      combined.push({
        id: project.id.toString(),
        source: "curseforge",
        name: project.name,
        description: project.summary,
        iconUrl: project.logo?.thumbnailUrl || project.logo?.url,
        downloads: project.downloadCount,
        categories: project.categories.map(c => c.name),
        versions: project.latestFilesIndexes ? Array.from(new Set(project.latestFilesIndexes.map(f => f.gameVersion))) : []
      });
    }

    // Ordenar por popularidad/descargas
    return combined.sort((a, b) => b.downloads - a.downloads);
  }

  /**
   * Modpacks recomendados combinados (Modrinth siempre; CurseForge solo con API key).
   * Con gameVersion, solo modpacks compatibles con esa versión de Minecraft.
   */
  async getRecommendedModpacks(limit = 12, gameVersion?: string): Promise<AddonResult[]> {
    const halfLimit = Math.max(1, Math.floor(limit / 2));
    const [modrinthResults, curseForgeResults] = await Promise.all([
      modrinthService.getPopularModpacks(halfLimit, gameVersion),
      curseForgeService.getPopularModpacks(halfLimit, gameVersion)
    ]);

    const combined: AddonResult[] = [];
    for (const project of modrinthResults) {
      combined.push({
        id: project.project_id,
        source: "modrinth",
        name: project.title,
        description: project.description,
        iconUrl: project.icon_url,
        downloads: project.downloads,
        categories: project.categories,
        versions: project.versions
      });
    }
    for (const project of curseForgeResults) {
      combined.push({
        id: project.id.toString(),
        source: "curseforge",
        name: project.name,
        description: project.summary,
        iconUrl: project.logo?.thumbnailUrl || project.logo?.url,
        downloads: project.downloadCount,
        categories: project.categories.map(c => c.name),
        versions: project.latestFilesIndexes ? Array.from(new Set(project.latestFilesIndexes.map(f => f.gameVersion))) : []
      });
    }

    return combined.sort((a, b) => b.downloads - a.downloads);
  }

  /**
   * Descarga e instala un modpack (Modrinth) dentro de targetDir:
   * - Los archivos del índice (mods/*, resourcepacks/*) según sus rutas.
   * - Los overrides en la raíz de targetDir.
   * Devuelve el nombre del pack y cuántos archivos se instalaron/fallaron.
   */
  async installModpack(
    source: string,
    projectId: string,
    gameVersion: string | undefined,
    targetDir: string
  ): Promise<{ name: string; installed: number; failed: number }> {
    if (source === "curseforge") {
      return curseForgeService.installModpack(projectId, gameVersion, targetDir);
    }
    if (source !== "modrinth") {
      throw new Error("Fuente no soportada: " + source);
    }

    const versions = await modrinthService.getVersions(projectId, gameVersion);
    const best = versions.find(v => v.files.some(f => f.filename.endsWith(".mrpack"))) || versions[0];
    if (!best) throw new Error("No hay versiones disponibles para este modpack.");
    const file = best.files.find(f => f.filename.endsWith(".mrpack")) || best.files[0];
    if (!file?.url) throw new Error("No se encontró el archivo .mrpack del modpack.");

    const mrpackPath = path.join(os.tmpdir(), `mrpack-${projectId}-${Date.now()}.mrpack`);
    const dl = await fetch(file.url);
    if (!dl.ok) throw new Error("Fallo al descargar el modpack");
    await fs.writeFile(mrpackPath, Buffer.from(await dl.arrayBuffer()));

    try {
      const zip = new AdmZip(mrpackPath);
      const indexEntry = zip.getEntry("modrinth.index.json");
      if (!indexEntry) throw new Error("El .mrpack no tiene modrinth.index.json");
      const index = JSON.parse(indexEntry.getData().toString("utf8"));

      const targetRoot = path.resolve(targetDir);
      let installed = 0;
      let failed = 0;
      for (const f of index.files ?? []) {
        if (f.env && f.env.server === "unsupported") continue; // solo cliente
        const relPath = String(f.path ?? "");
        if (!relPath || relPath.includes("..")) { failed++; continue; }
        const resolved = path.resolve(targetDir, relPath);
        if (!resolved.startsWith(targetRoot)) { failed++; continue; }
        const url0 = f.downloads?.[0];
        if (!url0) { failed++; continue; }
        try {
          const r = await fetch(url0);
          if (!r.ok) { failed++; continue; }
          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await fs.writeFile(resolved, Buffer.from(await r.arrayBuffer()));
          installed++;
        } catch { failed++; }
      }

      // Overrides → raíz del directorio destino
      const overrides = index.overrides ?? "overrides";
      for (const entry of zip.getEntries()) {
        if (!entry.entryName.startsWith(`${overrides}/`) || entry.isDirectory) continue;
        const rel = entry.entryName.slice(overrides.length + 1);
        const dest = path.resolve(targetDir, rel);
        if (!dest.startsWith(targetRoot)) continue;
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, entry.getData());
      }

      return { name: index.name ?? projectId, installed, failed };
    } finally {
      await fs.rm(mrpackPath, { force: true }).catch(() => {});
    }
  }

  /**
   * Obtiene la mejor versión descargable de un proyecto en base a los filtros.
   */
  async getAddonFiles(source: "modrinth" | "curseforge", id: string, gameVersion?: string, loader?: string): Promise<AddonVersionResult[]> {
    if (source === "modrinth") {
      const versions = await modrinthService.getVersions(id, gameVersion, loader);
      return versions.map(v => {
        const file = v.files.find(f => f.primary) || v.files[0];
        return {
          id: v.id,
          name: v.name,
          version: v.version_number,
          downloadUrl: file.url,
          filename: file.filename,
          size: file.size
        };
      });
    } else {
      const files = await curseForgeService.getFiles(parseInt(id, 10), gameVersion, loader);
      return files.map(f => ({
        id: f.id.toString(),
        name: f.displayName,
        version: f.displayName,
        downloadUrl: f.downloadUrl,
        filename: f.fileName,
        size: f.fileLength
      }));
    }
  }

  async getProjectDetails(source: "modrinth" | "curseforge", id: string): Promise<any> {
    if (source === "modrinth") {
      return await modrinthService.getProjectDetails(id);
    } else {
      return await curseForgeService.getProjectDetails(id);
    }
  }
}

export const addonSearchService = new AddonSearchService();
