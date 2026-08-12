import { env } from "../../config/env";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";

export interface CurseForgeProject {
  id: number;
  name: string;
  summary: string;
  logo?: {
    thumbnailUrl: string;
    url: string;
  };
  downloadCount: number;
  categories: { name: string }[];
  latestFilesIndexes?: { gameVersion: string }[];
}

export interface CurseForgeFile {
  id: number;
  displayName: string;
  fileName: string;
  downloadUrl: string;
  fileLength: number;
}

export class CurseForgeService {
  private readonly baseUrl = "https://api.curseforge.com/v1";
  private readonly gameId = 432; // Minecraft
  private readonly classId = 6;  // Mods

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Accept": "application/json"
    };
    if (env.curseforgeApiKey) {
      headers["x-api-key"] = env.curseforgeApiKey;
    }
    return headers;
  }

  async search(query: string, gameVersion?: string, loader?: string, limit = 20, type?: string): Promise<CurseForgeProject[]> {
    if (!env.curseforgeApiKey) {
      console.warn("[CurseForgeService] Search skipped: No API Key provided in .env");
      return [];
    }

    const url = new URL(`${this.baseUrl}/mods/search`);
    
    let currentClassId = this.classId;
    if (type === "modpack") currentClassId = 4471;
    
    url.searchParams.set("gameId", this.gameId.toString());
    url.searchParams.set("classId", currentClassId.toString());
    url.searchParams.set("searchFilter", query);
    url.searchParams.set("pageSize", limit.toString());
    url.searchParams.set("sortField", "2"); // 2 = Popularity
    url.searchParams.set("sortOrder", "desc");

    if (gameVersion) {
      url.searchParams.set("gameVersion", gameVersion);
    }
    if (loader) {
      // CurseForge modLoaderType enum: 1=Forge, 2=Cauldron, 3=LiteLoader, 4=Fabric, 5=Quilt, 6=NeoForge
      let modLoaderType = "";
      switch (loader.toLowerCase()) {
        case "forge": modLoaderType = "1"; break;
        case "fabric": modLoaderType = "4"; break;
        case "neoforge": modLoaderType = "6"; break;
      }
      if (modLoaderType) {
        url.searchParams.set("modLoaderType", modLoaderType);
      }
    }

    try {
      const response = await fetch(url.toString(), { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`CurseForge API responded with ${response.status}`);
      const data = (await response.json()) as any;
      return data.data as CurseForgeProject[];
    } catch (e: any) {
      console.error(`[CurseForgeService] Search error: ${e.message}`);
      return [];
    }
  }

  /**
   * Modpacks recomendados (classId 4471 = Modpacks) ordenados por popularidad.
   * Con gameVersion, solo modpacks con archivos para esa versión.
   * Requiere CURSEFORGE_API_KEY en .env; sin ella devuelve [] (como search).
   */
  async getPopularModpacks(limit = 12, gameVersion?: string): Promise<CurseForgeProject[]> {
    if (!env.curseforgeApiKey) {
      console.warn("[CurseForgeService] getPopularModpacks skipped: No API Key provided in .env");
      return [];
    }

    const url = new URL(`${this.baseUrl}/mods/search`);
    url.searchParams.set("gameId", this.gameId.toString());
    url.searchParams.set("classId", "4471"); // Modpacks
    url.searchParams.set("searchFilter", "");
    url.searchParams.set("pageSize", limit.toString());
    url.searchParams.set("sortField", "2"); // 2 = Popularity
    url.searchParams.set("sortOrder", "desc");
    if (gameVersion) url.searchParams.set("gameVersion", gameVersion);

    try {
      const response = await fetch(url.toString(), { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`CurseForge API responded with ${response.status}`);
      const data = (await response.json()) as any;
      return data.data as CurseForgeProject[];
    } catch (e: any) {
      console.error(`[CurseForgeService] getPopularModpacks error: ${e.message}`);
      return [];
    }
  }

  async getFiles(projectId: number, gameVersion?: string, loader?: string): Promise<CurseForgeFile[]> {
    if (!env.curseforgeApiKey) return [];

    const url = new URL(`${this.baseUrl}/mods/${projectId}/files`);
    if (gameVersion) {
      url.searchParams.set("gameVersion", gameVersion);
    }
    if (loader) {
      let modLoaderType = "";
      switch (loader.toLowerCase()) {
        case "forge": modLoaderType = "1"; break;
        case "fabric": modLoaderType = "4"; break;
        case "neoforge": modLoaderType = "6"; break;
      }
      if (modLoaderType) {
        url.searchParams.set("modLoaderType", modLoaderType);
      }
    }

    try {
      const response = await fetch(url.toString(), { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`CurseForge API responded with ${response.status}`);
      const data = (await response.json()) as any;
      return data.data as CurseForgeFile[];
    } catch (e: any) {
      console.error(`[CurseForgeService] getFiles error: ${e.message}`);
      return [];
    }
  }

  /**
   * Instala un modpack de CurseForge completo:
   * 1. Busca el archivo más reciente del proyecto (zip del modpack).
   * 2. Descarga el zip y lee manifest.json (lista de mods con projectID/fileID).
   * 3. Resuelve la URL de descarga de cada mod via la API y lo baja a mods/.
   * 4. Extrae la carpeta overrides/ a la raíz del servidor (configs, resourcepacks).
   * Requiere CURSEFORGE_API_KEY.
   */
  async installModpack(
    projectId: string,
    gameVersion: string | undefined,
    targetDir: string
  ): Promise<{ name: string; installed: number; failed: number }> {
    if (!env.curseforgeApiKey) {
      throw new Error("CurseForge requiere CURSEFORGE_API_KEY en .env. Obtené una gratis en https://console.curseforge.com/");
    }
    const id = parseInt(projectId, 10);
    if (isNaN(id)) throw new Error("ID de proyecto de CurseForge inválido.");

    // 1. Archivo más reciente del modpack (compatible con la versión del server si se pasa)
    let files = await this.getFiles(id, gameVersion);
    if ((!files || files.length === 0) && gameVersion) {
      files = await this.getFiles(id); // sin filtro de versión
    }
    if (!files || files.length === 0) {
      throw new Error("No se encontraron archivos para este modpack de CurseForge.");
    }
    const file = files[0];
    if (!file.downloadUrl) throw new Error("El modpack no tiene URL de descarga.");

    // 2. Descargar el zip del modpack desde el CDN
    const zipPath = path.join(os.tmpdir(), `cf-modpack-${id}-${Date.now()}.zip`);
    const dl = await fetch(file.downloadUrl, { headers: this.getHeaders() });
    if (!dl.ok) throw new Error("Fallo al descargar el modpack de CurseForge.");
    await fs.writeFile(zipPath, Buffer.from(await dl.arrayBuffer()));

    try {
      const zip = new AdmZip(zipPath);
      const manifestEntry = zip.getEntry("manifest.json");
      if (!manifestEntry) throw new Error("El zip de CurseForge no tiene manifest.json.");
      const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));

      const targetRoot = path.resolve(targetDir);
      let installed = 0;
      let failed = 0;

      // 3. Resolver y descargar cada mod de la lista del manifest
      for (const f of manifest.files ?? []) {
        const modId = f?.projectID;
        const fileId = f?.fileID;
        if (!modId || !fileId) { failed++; continue; }
        try {
          const urlRes = await fetch(`${this.baseUrl}/mods/${modId}/files/${fileId}/download-url`, { headers: this.getHeaders() });
          if (!urlRes.ok) { failed++; continue; }
          const data = (await urlRes.json()) as any;
          // El endpoint devuelve el URL como string directo ({ data: "https://..." }) o como objeto
          const dlUrl = typeof data?.data === "string" ? data.data : data?.data?.downloadUrl;
          if (!dlUrl) { failed++; continue; }
          const r = await fetch(dlUrl, { headers: this.getHeaders() });
          if (!r.ok) { failed++; continue; }
          const buf = Buffer.from(await r.arrayBuffer());
          const filename = decodeURIComponent(new URL(dlUrl).pathname.split("/").pop() || "") || `${modId}-${fileId}.jar`;
          const dest = path.resolve(targetDir, "mods", filename);
          if (!dest.startsWith(targetRoot)) { failed++; continue; }
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, buf);
          installed++;
        } catch { failed++; }
      }

      // 4. Overrides → raíz del directorio destino
      const overrides = manifest.overrides ?? "overrides";
      for (const entry of zip.getEntries()) {
        if (!entry.entryName.startsWith(`${overrides}/`) || entry.isDirectory) continue;
        const rel = entry.entryName.slice(overrides.length + 1);
        const dest = path.resolve(targetDir, rel);
        if (!dest.startsWith(targetRoot)) continue;
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, entry.getData());
      }

      return { name: manifest.name ?? file.displayName ?? `proyecto ${id}`, installed, failed };
    } finally {
      await fs.rm(zipPath, { force: true }).catch(() => {});
    }
  }

  async getProjectDetails(projectId: string): Promise<any> {
    if (!env.curseforgeApiKey) return null;
    try {
      // 1. Fetch project data
      const projectUrl = new URL(`${this.baseUrl}/mods/${projectId}`);
      const projectRes = await fetch(projectUrl.toString(), { headers: this.getHeaders() });
      if (!projectRes.ok) throw new Error(`CurseForge API responded with ${projectRes.status}`);
      const projectData = ((await projectRes.json()) as any).data;

      // 2. Fetch description (HTML)
      const descUrl = new URL(`${this.baseUrl}/mods/${projectId}/description`);
      const descRes = await fetch(descUrl.toString(), { headers: this.getHeaders() });
      let descriptionHtml = '';
      if (descRes.ok) {
        descriptionHtml = ((await descRes.json()) as any).data;
      }

      // 3. Count mods from the latest file's dependencies
      let modCount = 0;
      if (projectData.latestFiles && projectData.latestFiles.length > 0) {
        const latestFile = projectData.latestFiles[projectData.latestFiles.length - 1];
        if (latestFile.dependencies) {
          // RelationType 3 = RequiredDependency
          modCount = latestFile.dependencies.filter((d: any) => d.relationType === 3).length;
        }
      }

      return {
        id: projectData.id.toString(),
        name: projectData.name,
        description: projectData.summary,
        body: descriptionHtml,
        iconUrl: projectData.logo?.thumbnailUrl || projectData.logo?.url,
        downloads: projectData.downloadCount,
        categories: projectData.categories?.map((c: any) => c.name) || [],
        versions: projectData.latestFilesIndexes ? Array.from(new Set(projectData.latestFilesIndexes.map((f: any) => f.gameVersion))) : [],
        modCount: modCount,
        gallery: (projectData.screenshots || []).map((img: any) => img.url)
      };
    } catch (e: any) {
      console.error(`[CurseForgeService] getProjectDetails error: ${e.message}`);
      return null;
    }
  }
}

export const curseForgeService = new CurseForgeService();
