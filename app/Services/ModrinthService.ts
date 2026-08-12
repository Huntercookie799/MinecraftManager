import { env } from "../../config/env";

export interface ModrinthProject {
  project_id: string;
  title: string;
  description: string;
  icon_url?: string;
  downloads: number;
  categories: string[];
  versions: string[];
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  files: {
    url: string;
    filename: string;
    primary: boolean;
    size: number;
  }[];
}

export class ModrinthService {
  private readonly baseUrl = "https://api.modrinth.com/v2";

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": "MinecraftManager/0.1.0 (contacto@tu-dominio.com)"
    };
    if (env.modrinthApiToken) {
      headers["Authorization"] = env.modrinthApiToken;
    }
    return headers;
  }

  async search(query: string, gameVersion?: string, loader?: string, limit = 20, type?: string, category?: string): Promise<ModrinthProject[]> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("limit", limit.toString());

    // Si es búsqueda "popular" de modpacks (sin término o con el placeholder),
    // usamos el índice de descargas con query vacío para traer los más descargados.
    const isModpackPopular = type === "modpack" && (!query || query === "popular");
    if (isModpackPopular) {
      url.searchParams.set("query", "");
      url.searchParams.set("index", "downloads");
    } else {
      url.searchParams.set("query", query);
    }

    // Construir los facets (filtros)
    // Documentación: https://docs.modrinth.com/api-spec/#tag/projects/operation/searchProjects
    const facets: string[][] = [];
    if (gameVersion) {
      facets.push([`versions:${gameVersion}`]);
    }
    // El loader del servidor no aplica a modpacks (tienen su propio loader)
    if (loader && type !== "modpack") {
      facets.push([`categories:${loader}`]);
    }
    if (type) {
      facets.push([`project_type:${type}`]);
    }
    if (category) {
      facets.push([`categories:${category}`]);
    }

    if (facets.length > 0) {
      url.searchParams.set("facets", JSON.stringify(facets));
    }

    try {
      const response = await fetch(url.toString(), { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Modrinth API responded with ${response.status}`);
      const data = (await response.json()) as any;
      return data.hits.map((hit: any) => ({
        project_id: hit.project_id,
        title: hit.title,
        description: hit.description,
        icon_url: hit.icon_url,
        downloads: hit.downloads,
        categories: hit.categories || [],
        versions: hit.versions || []
      }));
    } catch (e: any) {
      console.error(`[ModrinthService] Search error: ${e.message}`);
      return [];
    }
  }

  /**
   * Modpacks recomendados: los más descargados (proyectos tipo modpack).
   * Con gameVersion, solo modpacks compatibles con esa versión de Minecraft.
   */
  async getPopularModpacks(limit = 12, gameVersion?: string): Promise<ModrinthProject[]> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("query", "");
    url.searchParams.set("limit", limit.toString());
    url.searchParams.set("index", "downloads");
    // Nota: en Modrinth cada facet va en su propio array interno para que se
    // combinen con AND (si van en el mismo array, el último pisa al otro).
    const facets: string[][] = [[`project_type:modpack`]];
    if (gameVersion) facets.push([`versions:${gameVersion}`]);
    url.searchParams.set("facets", JSON.stringify(facets));

    try {
      const response = await fetch(url.toString(), { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Modrinth API responded with ${response.status}`);
      const data = (await response.json()) as any;
      return data.hits.map((hit: any) => ({
        project_id: hit.project_id,
        title: hit.title,
        description: hit.description,
        icon_url: hit.icon_url,
        downloads: hit.downloads,
        categories: hit.categories || []
      }));
    } catch (e: any) {
      console.error(`[ModrinthService] getPopularModpacks error: ${e.message}`);
      return [];
    }
  }

  async getVersions(projectId: string, gameVersion?: string, loader?: string): Promise<ModrinthVersion[]> {
    const url = new URL(`${this.baseUrl}/project/${projectId}/version`);
    if (gameVersion) {
      url.searchParams.set("game_versions", JSON.stringify([gameVersion]));
    }
    if (loader) {
      url.searchParams.set("loaders", JSON.stringify([loader]));
    }

    try {
      const response = await fetch(url.toString(), { headers: this.getHeaders() });
      if (!response.ok) throw new Error(`Modrinth API responded with ${response.status}`);
      const data = await response.json();
      return data as ModrinthVersion[];
    } catch (e: any) {
      console.error(`[ModrinthService] getVersions error: ${e.message}`);
      return [];
    }
  }

  async getProjectDetails(projectId: string): Promise<any> {
    try {
      // 1. Fetch project data (includes body/markdown, gallery, etc.)
      const projectUrl = new URL(`${this.baseUrl}/project/${projectId}`);
      const projectRes = await fetch(projectUrl.toString(), { headers: this.getHeaders() });
      if (!projectRes.ok) throw new Error(`Modrinth API responded with ${projectRes.status}`);
      const projectData = (await projectRes.json()) as any;

      // 2. Fetch versions to count mods (dependencies of the latest version)
      const versionsUrl = new URL(`${this.baseUrl}/project/${projectId}/version`);
      const versionsRes = await fetch(versionsUrl.toString(), { headers: this.getHeaders() });
      let modCount = 0;
      if (versionsRes.ok) {
        const versionsData = (await versionsRes.json()) as any;
        if (versionsData && versionsData.length > 0) {
          // Tomar la versión más reciente y contar las dependencias marcadas como requeridas
          const latestVersion = versionsData[0];
          if (latestVersion.dependencies) {
            modCount = latestVersion.dependencies.filter((d: any) => d.dependency_type === 'required').length;
          }
        }
      }

      return {
        id: projectData.id,
        name: projectData.title,
        description: projectData.description,
        body: projectData.body,
        iconUrl: projectData.icon_url,
        downloads: projectData.downloads,
        categories: projectData.categories || [],
        versions: projectData.versions || [],
        modCount: modCount,
        gallery: (projectData.gallery || []).map((img: any) => img.url)
      };
    } catch (e: any) {
      console.error(`[ModrinthService] getProjectDetails error: ${e.message}`);
      return null;
    }
  }
}

export const modrinthService = new ModrinthService();
