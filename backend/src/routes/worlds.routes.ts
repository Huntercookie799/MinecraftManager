import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { Jimp } from "jimp";
import { prisma } from "../db/prisma";
import { serverManager } from "../services/ServerManager";

interface ServerParams {
  serverId: string;
}

interface WorldParams extends ServerParams {
  id: string;
}

interface CreateWorldBody {
  name: string;
}

export async function registerWorldsRoutes(app: FastifyInstance): Promise<void> {
  const thumbnailsDir = path.join(__dirname, "../../public/thumbnails");
  await fs.mkdir(thumbnailsDir, { recursive: true }).catch(() => {});

  async function getServerContext(serverIdStr: string, reply: FastifyReply) {
    const serverId = parseInt(serverIdStr, 10);
    if (isNaN(serverId)) {
      reply.code(400).send({ error: "Invalid server ID" });
      return null;
    }
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      reply.code(404).send({ error: "Server not found" });
      return null;
    }
    return server;
  }

  app.get<{ Params: ServerParams }>("/", async (request, reply) => {
    const serverId = parseInt(request.params.serverId, 10);
    const worlds = await prisma.world.findMany({
      where: { serverId },
      orderBy: { createdAt: "desc" }
    });
    return { worlds };
  });

  app.post<{ Params: ServerParams, Body: CreateWorldBody }>("/", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const { name } = request.body || {};
    if (!name || typeof name !== "string") return reply.code(400).send({ error: "Invalid name" });
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return reply.code(400).send({ error: "Name can only contain letters, numbers, hyphens and underscores." });

    const existing = await prisma.world.findUnique({ where: { serverId_name: { serverId: server.id, name } } });
    if (existing) return reply.code(409).send({ error: "A world with that name already exists in this server." });

    const totalWorlds = await prisma.world.count({ where: { serverId: server.id } });
    const isActive = totalWorlds === 0;

    const world = await prisma.world.create({
      data: { name, path: name, isActive, serverId: server.id }
    });

    return { world };
  });

  app.put<{ Params: WorldParams, Body: { name: string } }>("/:id", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    const { name } = request.body;
    
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });
    if (!name || !/^[a-zA-Z0-9_ -]+$/.test(name)) return reply.code(400).send({ error: "Invalid new name" });

    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "World not found" });

    const existing = await prisma.world.findUnique({ where: { serverId_name: { serverId: server.id, name } } });
    if (existing && existing.id !== worldId) {
      return reply.code(409).send({ error: "A world with that name already exists in this server." });
    }

    const worldsBackupDir = path.join(server.path, "worlds_backup");

    if (!world.isActive) {
      const oldPath = path.join(worldsBackupDir, world.path);
      const newPathName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const newPath = path.join(worldsBackupDir, newPathName);
      
      try {
        await fs.rename(oldPath, newPath);
        await prisma.world.update({ where: { id: worldId }, data: { name, path: newPathName } });
      } catch (e) {
        await prisma.world.update({ where: { id: worldId }, data: { name } });
      }
    } else {
      await prisma.world.update({ where: { id: worldId }, data: { name } });
    }

    return { success: true };
  });

  app.post<{ Params: ServerParams }>("/upload", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });

    const nameField = data.fields.name;
    let name = (nameField && 'value' in nameField) ? String(nameField.value) : data.filename.replace(".zip", "");
    name = name.replace(/[^a-zA-Z0-9_-]/g, "_"); 

    const existing = await prisma.world.findUnique({ where: { serverId_name: { serverId: server.id, name } } });
    if (existing) name = `${name}_${Date.now()}`;

    const worldsBackupDir = path.join(server.path, "worlds_backup");
    const tempZipPath = path.join(worldsBackupDir, `${name}_temp.zip`);
    await fs.mkdir(worldsBackupDir, { recursive: true });

    await pipeline(data.file, createWriteStream(tempZipPath));

    try {
      const zip = new AdmZip(tempZipPath);
      const worldPath = path.join(worldsBackupDir, name);
      zip.extractAllTo(worldPath, true);
      
      const world = await prisma.world.create({
        data: { name, path: name, isActive: false, serverId: server.id }
      });

      return { success: true, world };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: "Failed to extract ZIP" });
    } finally {
      await fs.rm(tempZipPath, { force: true }).catch(() => {});
    }
  });

  app.post<{ Params: WorldParams }>("/:id/thumbnail", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });

    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "World not found" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });

    const ext = path.extname(data.filename) || ".png";
    const thumbnailName = `world_${worldId}_${Date.now()}${ext}`;
    const dest = path.join(thumbnailsDir, thumbnailName);

    await pipeline(data.file, createWriteStream(dest));

    await prisma.world.update({ where: { id: worldId }, data: { thumbnail: `/thumbnails/${thumbnailName}` } });

    if (world.thumbnail) {
      const oldThumb = path.join(__dirname, "../../public", world.thumbnail);
      await fs.rm(oldThumb, { force: true }).catch(() => {});
    }

    try {
      const image = await Jimp.read(dest);
      image.resize({ w: 64, h: 64 });
      if (world.isActive) {
        await image.write(path.join(server.path, "server-icon.png") as any);
      }
    } catch (e) {
      app.log.error("Failed to process thumbnail for server-icon.png", e as any);
    }

    return { success: true, thumbnail: `/thumbnails/${thumbnailName}` };
  });

  app.get<{ Params: WorldParams }>("/:id/export", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });

    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "World not found" });

    const service = serverManager.getServiceById(server.id);
    if (world.isActive && service && service.getStatus().status !== "OFFLINE") {
      return reply.code(409).send({ error: "Cannot export the active world while the server is running." });
    }

    const zip = new AdmZip();
    const foldersToZip = ["world", "world_nether", "world_the_end"];
    const worldsBackupDir = path.join(server.path, "worlds_backup");

    try {
      if (world.isActive) {
        for (const folder of foldersToZip) {
          const folderPath = path.join(server.path, folder);
          try {
            await fs.access(folderPath);
            zip.addLocalFolder(folderPath, folder);
          } catch {}
        }
      } else {
        const backupPath = path.join(worldsBackupDir, world.path);
        for (const folder of foldersToZip) {
          const folderPath = path.join(backupPath, folder);
          try {
            await fs.access(folderPath);
            zip.addLocalFolder(folderPath, folder);
          } catch {}
        }
      }

      const buffer = zip.toBuffer();
      reply.header('Content-Disposition', `attachment; filename="${world.name}.zip"`);
      reply.type('application/zip');
      return reply.send(buffer);
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: "Failed to create ZIP file" });
    }
  });

  app.post<{ Params: WorldParams }>("/:id/load", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });

    const worldToLoad = await prisma.world.findUnique({ where: { id: worldId } });
    if (!worldToLoad || worldToLoad.serverId !== server.id) return reply.code(404).send({ error: "World not found" });
    if (worldToLoad.isActive) return reply.code(400).send({ error: "World is already active" });

    const service = serverManager.getServiceById(server.id);
    if (service && service.getStatus().status !== "OFFLINE") {
      return reply.code(409).send({ error: "You must stop the Minecraft server before changing the active world." });
    }

    const worldsBackupDir = path.join(server.path, "worlds_backup");
    await fs.mkdir(worldsBackupDir, { recursive: true });

    const activeWorld = await prisma.world.findFirst({ where: { serverId: server.id, isActive: true } });
    const foldersToSwap = ["world", "world_nether", "world_the_end"];

    if (activeWorld) {
      const backupPath = path.join(worldsBackupDir, activeWorld.path);
      await fs.mkdir(backupPath, { recursive: true });

      for (const folder of foldersToSwap) {
        const src = path.join(server.path, folder);
        const dest = path.join(backupPath, folder);
        try {
          await fs.access(src);
          await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
          await fs.rename(src, dest);
        } catch {}
      }
      await prisma.world.update({ where: { id: activeWorld.id }, data: { isActive: false } });
    }

    const loadPath = path.join(worldsBackupDir, worldToLoad.path);
    for (const folder of foldersToSwap) {
      const src = path.join(loadPath, folder);
      const dest = path.join(server.path, folder);
      try {
        await fs.access(src);
        await fs.rename(src, dest);
      } catch {}
    }

    await prisma.world.update({ where: { id: worldId }, data: { isActive: true } });

    if (worldToLoad.thumbnail) {
      const thumbPath = path.join(__dirname, "../../public", worldToLoad.thumbnail);
      try {
        const image = await Jimp.read(thumbPath);
        image.resize({ w: 64, h: 64 });
        await image.write(path.join(server.path, "server-icon.png") as any);
      } catch (e) {
        app.log.error("Failed to process thumbnail on load", e as any);
      }
    } else {
      await fs.rm(path.join(server.path, "server-icon.png"), { force: true }).catch(() => {});
    }

    return { success: true, message: `World ${worldToLoad.name} is now active.` };
  });

  app.delete<{ Params: WorldParams }>("/:id", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    const world = await prisma.world.findUnique({ where: { id: worldId } });
    
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "World not found" });
    if (world.isActive) return reply.code(400).send({ error: "Cannot delete the active world. Switch to another world first." });

    const worldsBackupDir = path.join(server.path, "worlds_backup");
    const worldPath = path.join(worldsBackupDir, world.path);
    
    try {
      await fs.rm(worldPath, { recursive: true, force: true });
    } catch {}

    if (world.thumbnail) {
      const thumbPath = path.join(__dirname, "../../public", world.thumbnail);
      await fs.rm(thumbPath, { force: true }).catch(() => {});
    }

    await prisma.world.delete({ where: { id: worldId } });

    return { success: true };
  });
}
