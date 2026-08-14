import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { prisma } from "../../Models/prisma";
import { addonSearchService } from "../../Services/AddonSearchService";
import { sanitizeExtractedWorld } from "./WorldController";

export async function registerUtilsRoutes(app: FastifyInstance) {
  // Analyze a .zip world
  app.post("/analyze-world", async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });

    const tempDir = path.join(os.tmpdir(), "minecraft_manager_temp_worlds");
    await fs.mkdir(tempDir, { recursive: true });

    const tempName = `world_${Date.now()}.zip`;
    const tempZipPath = path.join(tempDir, tempName);

    await pipeline(data.file, createWriteStream(tempZipPath));

    try {
      const zip = new AdmZip(tempZipPath);
      let version = null;
      let loader = null; // null means vanilla/paper/purpur
      let hasMods = false;

      // Extract only level.dat to memory if possible
      const levelDatEntry = zip.getEntry("level.dat") || zip.getEntry("world/level.dat") || zip.getEntries().find(e => e.entryName.endsWith("/level.dat"));
      if (levelDatEntry) {
        const buf = levelDatEntry.getData();
        try {
          const nbt = require("prismarine-nbt");
          const { parsed } = await nbt.parse(buf);
          version = parsed.value?.Data?.value?.Version?.value?.Name?.value || null;
        } catch (e: any) {
          app.log.error(e, "Failed to parse level.dat");
        }
      }

      // Check for mods directory
      const modEntries = zip.getEntries().filter(e => e.entryName.includes("mods/") && e.entryName.endsWith(".jar"));
      if (modEntries.length > 0) {
        hasMods = true;
        // Try to guess loader
        const isFabric = modEntries.some(e => e.entryName.toLowerCase().includes("fabric-api"));
        loader = isFabric ? "fabric" : "forge"; // Default to forge if has mods and not fabric
      }

      return { success: true, tempPath: tempZipPath, version, loader, hasMods };
    } catch (err: any) {
      app.log.error(err, "Failed to analyze ZIP");
      await fs.rm(tempZipPath, { force: true }).catch(() => {});
      return reply.code(500).send({ error: "Failed to analyze ZIP" });
    }
  });

  // Install analyzed world to a server
  app.post<{ Body: { serverId: number; tempPath: string; worldName: string } }>("/install-world", async (request, reply) => {
    const { serverId, tempPath, worldName } = request.body;
    if (!serverId || !tempPath || !worldName) return reply.code(400).send({ error: "Missing parameters" });

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    try {
      await fs.access(tempPath);
    } catch {
      return reply.code(404).send({ error: "Archived world not found or expired" });
    }

    let finalName = worldName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const existing = await prisma.world.findUnique({ where: { serverId_name: { serverId, name: finalName } } });
    if (existing) finalName = `${finalName}_${Date.now()}`;

    const worldsBackupDir = path.join(server.path, "worlds_backup");
    await fs.mkdir(worldsBackupDir, { recursive: true });

    try {
      const zip = new AdmZip(tempPath);
      const worldPath = path.join(worldsBackupDir, finalName);
      zip.extractAllTo(worldPath, true);
      
      await sanitizeExtractedWorld(worldPath);

      const world = await prisma.world.create({
        data: { name: finalName, path: finalName, isActive: false, serverId: server.id }
      });

      // Cleanup temp zip
      await fs.rm(tempPath, { force: true }).catch(() => {});

      return { success: true, world };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: "Failed to extract ZIP to server" });
    }
  });

  // Global Addon Search
  app.get<{ Querystring: { q: string, version?: string, loader?: string, limit?: string, type?: string, category?: string } }>("/addons/search", async (request, reply) => {
    const { q, limit, type, category } = request.query;
    if (!q) return reply.code(400).send({ error: "Falta el término de búsqueda 'q'" });
    const limitNum = limit ? parseInt(limit, 10) : 20;

    let version = request.query.version;
    let loader = request.query.loader;
    if (version === "any") version = undefined;
    if (loader === "any") loader = undefined;

    try {
      const results = await addonSearchService.search(q, version, loader, limitNum, type, category);
      return { success: true, items: results };
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ error: e.message });
    }
  });

  // Global Addon Details
  app.get<{ Params: { source: "modrinth" | "curseforge", id: string } }>("/addons/details/:source/:id", async (request, reply) => {
    const { source, id } = request.params;
    try {
      const details = await addonSearchService.getProjectDetails(source, id);
      return { success: true, details };
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ error: e.message });
    }
  });
}
