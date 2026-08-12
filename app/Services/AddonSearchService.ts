import { modrinthService, type ModrinthProject, type ModrinthVersion } from "./ModrinthService";
import { curseForgeService, type CurseForgeProject, type CurseForgeFile } from "./CurseForgeService";

export interface AddonResult {
  id: string; // Project ID
  source: "modrinth" | "curseforge";
  name: string;
  description: string;
  iconUrl?: string;
  downloads: number;
  categories: string[];
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
  async search(query: string, gameVersion?: string, loader?: string, limit = 20): Promise<AddonResult[]> {
    // Para simplificar, dividimos el límite a la mitad para cada proveedor
    const halfLimit = Math.max(1, Math.floor(limit / 2));

    const [modrinthResults, curseForgeResults] = await Promise.all([
      modrinthService.search(query, gameVersion, loader, halfLimit),
      curseForgeService.search(query, gameVersion, loader, halfLimit)
    ]);

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
        categories: project.categories
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
        categories: project.categories.map(c => c.name)
      });
    }

    // Ordenar por popularidad/descargas
    return combined.sort((a, b) => b.downloads - a.downloads);
  }

  /**
   * Obtiene la mejor versión descargable de un proyecto en base a los filtros.
   */
  async getVersions(source: "modrinth" | "curseforge", projectId: string, gameVersion?: string, loader?: string): Promise<AddonVersionResult[]> {
    if (source === "modrinth") {
      const versions = await modrinthService.getVersions(projectId, gameVersion, loader);
      return versions.map(v => {
        const file = v.files.find(f => f.primary) || v.files[0];
        return {
          id: v.id,
          name: v.name,
          version: v.version_number,
          downloadUrl: file?.url || "",
          filename: file?.filename || "",
          size: file?.size || 0
        };
      }).filter(v => v.downloadUrl);
    } else {
      const files = await curseForgeService.getFiles(parseInt(projectId, 10), gameVersion, loader);
      return files.map(f => ({
        id: f.id.toString(),
        name: f.displayName,
        version: f.displayName,
        downloadUrl: f.downloadUrl,
        filename: f.fileName,
        size: f.fileLength
      })).filter(v => v.downloadUrl);
    }
  }
}

export const addonSearchService = new AddonSearchService();
