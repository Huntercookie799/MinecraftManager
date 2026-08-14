import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { addonSearchService } from "./AddonSearchService";
import type { MinecraftServerConfig } from "./MinecraftService";

export class AutoRepairService {
  /**
   * Analiza el último log del servidor y busca errores de dependencias faltantes.
   * Si las encuentra, intenta descargarlas e instalarlas automáticamente.
   * Retorna true si se instaló al menos un mod nuevo.
   */
  async analyzeAndRepair(
    config: MinecraftServerConfig, 
    logCallback: (msg: string) => void,
    consoleOutput?: string
  ): Promise<boolean> {
    try {
      const logPath = path.join(config.directory, "logs", "latest.log");
      let content = consoleOutput || "";
      
      try {
        if (fsSync.existsSync(logPath)) {
          content += "\n" + (await fs.readFile(logPath, "utf8"));
        }
      } catch (err: any) {
        logCallback(`[Auto-Repair] No se pudo leer latest.log: ${err.message}`);
        return false;
      }

      if (!content.trim()) {
        return false;
      }

      // Eliminar códigos ANSI y códigos de formato de Minecraft (§a, etc.)
      const cleanContent = content.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/§[0-9a-fk-or]/ig, "");

      const missingDependencies = this.extractMissingDependencies(cleanContent);

      if (missingDependencies.size === 0) {
        return false;
      }

      logCallback(`[Auto-Repair] Se encontraron dependencias faltantes: ${Array.from(missingDependencies).join(", ")}`);
      
      const modsDir = path.join(config.directory, "mods");
      await fs.mkdir(modsDir, { recursive: true });

      let installedCount = 0;

      // El loader del servidor (fabric, forge, neoforge, paper)
      let loader = config.softwareType || "forge";
      if (loader === "purpur") loader = "paper";

      for (const dep of missingDependencies) {
        try {
          logCallback(`[Auto-Repair] Buscando mod: ${dep}...`);
          // Buscar mod en Modrinth/CurseForge
          let results = await addonSearchService.search(dep, config.version, loader, 30);
          
          if (!results || results.length === 0) {
            // Intento de fallback: separar palabras comunes que los mods suelen juntar en el slug
            const spacedDep = dep
              .replace(/(lib|api|core|delight|mod|craft)$/i, ' $1')
              .replace(/^(ftb|better|yungs|fast|dragon|farmers|macaws|resourceful|puzzles)/i, '$1 ')
              .replace(/_/g, ' ')
              .trim();
              
            if (spacedDep !== dep) {
              logCallback(`[Auto-Repair] Reintentando búsqueda con: "${spacedDep}"...`);
              results = await addonSearchService.search(spacedDep, config.version, loader, 30);
            }
          }

          if (!results || results.length === 0) {
            logCallback(`[Auto-Repair] No se encontró el mod ${dep} para la versión ${config.version} y loader ${loader}.`);
            continue;
          }

          // Tratar de encontrar el match exacto basado en el slug o nombre
          const normalizedDep = dep.toLowerCase().replace(/[^a-z0-9]/g, '');
          let bestMatch = results.find(r => 
            r.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedDep || 
            r.id.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedDep
          );
          
          if (!bestMatch) {
            bestMatch = results.find(r => r.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(normalizedDep)) || results[0];
          }
          
          const files = await addonSearchService.getAddonFiles(bestMatch.source, bestMatch.id, config.version, loader);
          if (!files || files.length === 0) {
            logCallback(`[Auto-Repair] No hay archivos compatibles para ${bestMatch.name}.`);
            continue;
          }

          const fileToDownload = files[0];
          const destPath = path.join(modsDir, fileToDownload.filename);
          
          logCallback(`[Auto-Repair] Descargando ${fileToDownload.filename}...`);
          
          const dlRes = await fetch(fileToDownload.downloadUrl);
          if (!dlRes.ok) {
            throw new Error(`Error HTTP ${dlRes.status} al descargar`);
          }
          
          const arrayBuffer = await dlRes.arrayBuffer();
          await fs.writeFile(destPath, Buffer.from(arrayBuffer));
          
          logCallback(`[Auto-Repair] ¡Mod ${fileToDownload.filename} instalado con éxito!`);
          installedCount++;

        } catch (e: any) {
          logCallback(`[Auto-Repair] Error instalando dependencia ${dep}: ${e.message}`);
        }
      }

      return installedCount > 0;
    } catch (e: any) {
      logCallback(`[Auto-Repair] Error crítico durante auto-reparación: ${e.message}`);
      return false;
    }
  }

  /**
   * Analiza el texto del log buscando patrones de dependencias faltantes
   * de Forge y Fabric. Devuelve un Set con los slugs/nombres de los mods faltantes.
   */
  private extractMissingDependencies(logContent: string): Set<string> {
    const missing = new Set<string>();

    const lines = logContent.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\uFFFD[0-9a-zA-Z]?/g, "");
      
      
      // Forge: "Failure message: Mod mes requires moogs_structures 1.0.0 or above"
      // o Forge: "Mod ftbxmodcompat requires architectury 9.0.8 or above"
      // o "Mod eftbxmodcompatr requires architectury o9.0.8 or above" (sin ansi)
      const reqMatch = line.match(/requires\s+([a-zA-Z0-9_-]+)\s+/i);
      
      if (reqMatch) {
        const depName = reqMatch[1];
        // Revisar las siguientes 2 líneas para confirmar si falta
        for (let j = 1; j <= 2; j++) {
          if (i + j < lines.length) {
            const nextLine = lines[i + j];
            if (nextLine.includes("not installed") || nextLine.includes("missing") || nextLine.includes("onnot installed")) {
              missing.add(depName.toLowerCase());
              break;
            }
          }
        }
      }

      // Forge viejo o NeoForge / dependencias absolutas
      const missingMatch = line.match(/Missing (?:mandatory )?dependencies:?\s*([a-zA-Z0-9_-]+)/i);
      if (missingMatch) {
        missing.add(missingMatch[1].toLowerCase());
      }
      
      // Forge nuevo: "Mod ID: 'ftblibrary', Requested by: 'ftbquests', Expected range: '[2001.2.1,)', Actual version: '[MISSING]'"
      const modIdMatch = line.match(/Mod ID:\s*'([a-zA-Z0-9_-]+)'.*Actual version:\s*'\[MISSING\]'/i);
      if (modIdMatch) {
        missing.add(modIdMatch[1].toLowerCase());
      }
      
      // Fabric: "[HARD_DEP_NO_CANDIDATE betternether 9.0.10 {depends bclib @ [3.0.x]}]"
      const fabricMatch = line.match(/\[HARD_DEP_NO_CANDIDATE[^{]+{depends\s+([a-zA-Z0-9_-]+)/i);
      if (fabricMatch) {
        missing.add(fabricMatch[1].toLowerCase());
      }

      // Quilt / Fabric: " - Mod 'X' (...) requires mod 'Y' (...), which is missing!"
      const quiltMatch = line.match(/requires\s+mod\s+'([a-zA-Z0-9_-]+)'.*which\s+is\s+missing/i);
      if (quiltMatch) {
        missing.add(quiltMatch[1].toLowerCase());
      }
    }

    // Filtrar falsos positivos
    const ignoreList = ["minecraft", "forge", "fabric", "fabricloader", "fabric-api", "quilt_loader", "java"];
    for (const ignore of ignoreList) {
      missing.delete(ignore);
    }

    return missing;
  }
}

export const autoRepairService = new AutoRepairService();
