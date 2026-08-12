import { env } from "../../config/env";

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

  async search(query: string, gameVersion?: string, loader?: string, limit = 20): Promise<CurseForgeProject[]> {
    if (!env.curseforgeApiKey) {
      console.warn("[CurseForgeService] Search skipped: No API Key provided in .env");
      return [];
    }

    const url = new URL(`${this.baseUrl}/mods/search`);
    url.searchParams.set("gameId", this.gameId.toString());
    url.searchParams.set("classId", this.classId.toString());
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
}

export const curseForgeService = new CurseForgeService();
