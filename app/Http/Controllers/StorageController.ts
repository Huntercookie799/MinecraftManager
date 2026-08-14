import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../Models/prisma";
import { S3SyncService } from "../../Services/S3SyncService";
import fs from "node:fs/promises";
import path from "node:path";

const s3Sync = new S3SyncService();

async function getFolderSize(folderPath: string): Promise<number> {
  let totalSize = 0;
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getFolderSize(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch (err: any) {
    // Ignore locked files or missing folders
  }
  return totalSize;
}

export async function registerStorageRoutes(app: FastifyInstance) {
  app.get("/spaces", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const servers = await prisma.server.findMany();
      const result = [];

      for (const server of servers) {
        let totalSize = 0;
        const worlds = [];
        const worldsBackupDir = path.join(server.path, "worlds_backup");

        // Calcular tamaño del servidor principal (ignorar worlds_backup por separado, o incluirlo)
        totalSize = await getFolderSize(server.path);

        // Si tiene mundos nativos o en el backup, calcularlos
        // Para simplificar, buscaremos el folder "world", "world_nether", "world_the_end" y los de worlds_backup
        const possibleWorlds = ["world", "world_nether", "world_the_end"];
        for (const w of possibleWorlds) {
          const wPath = path.join(server.path, w);
          try {
            const stat = await fs.stat(wPath);
            if (stat.isDirectory()) {
              const size = await getFolderSize(wPath);
              worlds.push({ name: w, size, type: "active" });
            }
          } catch (e) {}
        }

        try {
          const backups = await fs.readdir(worldsBackupDir, { withFileTypes: true });
          for (const b of backups) {
            if (b.isDirectory()) {
              const size = await getFolderSize(path.join(worldsBackupDir, b.name));
              worlds.push({ name: b.name, size, type: "backup" });
            }
          }
        } catch (e) {}

        // También agregar mundos de la BD si no han sido capturados (por si tienen nombres custom)
        const dbWorlds = await prisma.world.findMany({ where: { serverId: server.id } });
        for (const dbW of dbWorlds) {
          if (!worlds.find(w => w.name === dbW.name)) {
            const dbPath = path.join(worldsBackupDir, dbW.name);
            const size = await getFolderSize(dbPath);
            worlds.push({ name: dbW.name, size, type: "backup" });
          }
        }

        result.push({
          id: server.id,
          name: server.name,
          path: server.path,
          totalSize,
          worlds
        });
      }

      return reply.send({ success: true, servers: result });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post<{ Body: { serverId: number; folder?: string } }>("/sync", async (request, reply) => {
    const { serverId, folder } = request.body;
    if (!serverId) {
      return reply.code(400).send({ error: "Falta serverId" });
    }

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      return reply.code(404).send({ error: "Servidor no encontrado" });
    }

    if (!s3Sync.isConfigured) {
      return reply.code(400).send({ error: "S3 no está configurado. No se puede sincronizar con la nube." });
    }

    // Si se pasa 'folder', sincronizamos ese mundo específicamente.
    // Si no, sincronizamos todo el servidor.
    try {
      if (folder) {
        // Podría ser "world" o "worlds_backup/Mundo1"
        const sourcePath = path.join(server.path, folder);
        const destinationKey = `${server.id}/${folder}_backup.zip`;
        await s3Sync.zipAndUploadFolder(sourcePath, destinationKey, console.log);
      } else {
        await s3Sync.zipAndUpload(server.path, server.id, console.log);
      }
      return reply.send({ success: true });
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.delete<{ Body: { serverId: number; folder: string } }>("/delete", async (request, reply) => {
    const { serverId, folder } = request.body;
    if (!serverId || !folder) {
      return reply.code(400).send({ error: "Falta serverId o folder" });
    }

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      return reply.code(404).send({ error: "Servidor no encontrado" });
    }

    // Proteger contra eliminaciones fuera de la carpeta del servidor
    if (folder.includes("..") || folder === "/" || folder === "") {
      return reply.code(400).send({ error: "Ruta de carpeta inválida" });
    }

    const targetPath = path.join(server.path, folder);

    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      
      // Intentar borrarlo de la base de datos si es que estaba registrado
      let worldName = folder;
      if (folder.startsWith("worlds_backup/")) {
        worldName = folder.replace("worlds_backup/", "");
      }
      
      await prisma.world.deleteMany({
        where: {
          serverId: server.id,
          name: worldName
        }
      });

      return reply.send({ success: true });
    } catch (e: any) {
      return reply.code(500).send({ error: "No se pudo eliminar: " + e.message });
    }
  });
}
