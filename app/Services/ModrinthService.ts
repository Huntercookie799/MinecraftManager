import { env } from "../../config/env";

export interface ModrinthProject {
  project_id: string;
  title: string;
  description: string;
  icon_url?: string;
  downloads: number;
  categories: string[];
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

  async search(query: string, gameVersion?: string, loader?: string, limit = 20): Promise<ModrinthProject[]> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("limit", limit.toString());

    // Construir los facets (filtros)
    // Documentación: https://docs.modrinth.com/api-spec/#tag/projects/operation/searchProjects
    const facets: string[][] = [];
    if (gameVersion) {
      facets.push([`versions:${gameVersion}`]);
    }
    if (loader) {
      facets.push([`categories:${loader}`]);
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
        categories: hit.categories || []
      }));
    } catch (e: any) {
      console.error(`[ModrinthService] Search error: ${e.message}`);
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
}

export const modrinthService = new ModrinthService();
