import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { serverManager } from "../../Services/ServerManager";
import { MinecraftServiceError } from "../../Services/MinecraftService";
import { prisma } from "../../Models/prisma";
import { env } from "../../../config/env";
import fs from "node:fs/promises";
import { S3SyncService } from "../../Services/S3SyncService";
import { jarManager } from "../../Services/JarManager";

interface LogsQuery {
  sinceId?: string;
}

interface CommandBody {
  command?: string;
}

interface CreateServerBody {
  name: string;
  memory?: string;
  port?: number;
  version?: string;
}

const DEFAULT_MC_VERSION = "1.21.8";

interface FilesQuery {
  path?: string;
}

// ─── Helper: format bytes ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ─── Helper: check if world exists ───────────────────────────────────────────

async function checkWorldExists(serverPath: string, worldName = "world"): Promise<boolean> {
  try {
    await fs.access(path.join(serverPath, worldName));
    return true;
  } catch {
    return false;
  }
}

export async function registerServerRoutes(app: FastifyInstance): Promise<void> {
  // Global R2 Files
  app.get<{ Params: { id: string } }>("/:id/s3/files", async (request, reply) => {
    try {
      const serverId = request.params.id;
      const s3 = new S3SyncService();
      if (!s3.isConfigured) {
        return reply.code(400).send({ error: "S3 Sync is not configured" });
      }
      
      const prefix = `${serverId}/`;
      const objects = await s3.listObjects(prefix);
      
      const items = objects.map(obj => ({
        name: obj.key?.replace(prefix, '') || '', // Remover el prefijo para mostrar solo el nombre del archivo
        path: obj.key,
        type: "file",
        size: obj.size,
        sizeFormatted: formatBytes(obj.size || 0),
        modified: obj.lastModified ? obj.lastModified.toISOString() : "",
        extension: path.extname(obj.key || "").toLowerCase()
      }));

      return {
        currentPath: `R2 Bucket (${prefix})`,
        parentPath: null,
        serverExists: true,
        items
      };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });
  // List all servers
  // List available Minecraft versions (Purpur)
  app.get("/versions", async () => {
    const versions = await jarManager.listVersions();
    return { versions };
  });

  app.get("/", async () => {
    const servers = await prisma.server.findMany();
    const result = await Promise.all(servers.map(async s => {
      const service = serverManager.getService({
        id: s.id,
        name: s.name,
        directory: s.path,
        port: s.port,
        memory: s.memory,
        version: s.version ?? undefined
      });
      await service.tryAdopt();
      const worldExists = await checkWorldExists(s.path);
      return {
        ...s,
        worldExists,
        status: service.getStatus()
      };
    }));
    return { servers: result };
  });

  // Create a server
  app.post<{ Body: CreateServerBody }>("/", async (request, reply) => {
    const { name, memory, port, version } = request.body;
    if (!name) return reply.code(400).send({ error: "Missing name" });

    const mcVersion = version || DEFAULT_MC_VERSION;
    if (!/^\d+\.\d+(\.\d+)?$/.test(mcVersion)) {
      return reply.code(400).send({ error: "Invalid Minecraft version format" });
    }

    // Assign port
    let assignedPort = port;
    if (!assignedPort) {
      const lastServer = await prisma.server.findFirst({ orderBy: { port: 'desc' } });
      assignedPort = lastServer ? lastServer.port + 1 : 25565;
    }

    const folderName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const serverPath = path.join(process.cwd(), "minecraft_servers", folderName);

    try {
      const server = await prisma.server.create({
        data: {
          name,
          port: assignedPort,
          memory: memory || "2G",
          version: mcVersion,
          path: serverPath
        }
      });
      return { success: true, server };
    } catch (e: any) {
      if (e.code === 'P2002') return reply.code(400).send({ error: "Name or port already exists" });
      throw e;
    }
  });

  // Update server settings (name, avatar, accent color)
  app.put<{ Params: { id: string } }>("/:id/settings", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    // Multipart upload for avatar
    let avatarUrl: string | null = null;
    const contentType = request.headers["content-type"] || "";
    
    if (contentType.includes("multipart/form-data")) {
      const data = await request.file();
      if (data) {
        const ext = path.extname(data.filename) || ".png";
        if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext.toLowerCase())) {
          return reply.code(400).send({ error: "Invalid image format. Allowed: png, jpg, jpeg, gif, webp" });
        }
        const fileName = `server_${id}_avatar${ext}`;
        const uploadDir = path.join(__dirname, "..", "..", "..", "public", "server-icons");
        await fs.mkdir(uploadDir, { recursive: true });
        const dest = path.join(uploadDir, fileName);
        await pipeline(data.file, createWriteStream(dest));
        avatarUrl = `/server-icons/${fileName}`;

        // Delete old avatar if exists
        if (server.avatar) {
          const oldPath = path.join(__dirname, "..", "..", "..", "public", server.avatar);
          await fs.rm(oldPath, { force: true }).catch(() => {});
        }
      }
    }

    // Accept JSON body for name & accentColor update
    let updateData: any = {};
    if (contentType.includes("application/json")) {
      const body = request.body as any || {};
      if (body.name && body.name !== server.name) {
        // Validate name uniqueness
        const existing = await prisma.server.findUnique({ where: { name: body.name } });
        if (existing && existing.id !== id) {
          return reply.code(409).send({ error: "A server with that name already exists" });
        }
        updateData.name = body.name;
      }
      if (body.accentColor) {
        if (!/^#[0-9a-fA-F]{6}$/.test(body.accentColor)) {
          return reply.code(400).send({ error: "Invalid accent color. Use hex format e.g. #FF55FF" });
        }
        updateData.accentColor = body.accentColor;
      }
    }

    if (avatarUrl) updateData.avatar = avatarUrl;

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ error: "No fields to update" });
    }

    const updated = await prisma.server.update({ where: { id }, data: updateData });
    return { success: true, server: updated };
  });

  // Delete a server
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    serverManager.removeService(id);
    await prisma.server.delete({ where: { id } });
    await fs.rm(server.path, { recursive: true, force: true }).catch(() => {});
    
    return { success: true };
  });

  // Middleware to get server config
  async function withService(idStr: string, reply: FastifyReply, action: (service: any) => Promise<any>) {
    const id = parseInt(idStr, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });
    
    const service = serverManager.getService({
      id: server.id,
      name: server.name,
      directory: server.path,
      port: server.port,
      memory: server.memory,
      version: server.version
    });
    await service.tryAdopt();
    
    try {
      return await action(service);
    } catch (error) {
      if (error instanceof MinecraftServiceError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  }

  app.get<{ Params: { id: string } }>("/:id/status", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const service = serverManager.getService({
      id: server.id,
      name: server.name,
      directory: server.path,
      port: server.port,
      memory: server.memory,
      version: server.version
    });
    await service.tryAdopt();

    const status = service.getStatus();
    const worldExists = await checkWorldExists(server.path);

    return { ...status, worldExists };
  });

  app.post<{ Params: { id: string } }>("/:id/start", async (request, reply) => {
    return withService(request.params.id, reply, async (service) => service.start());
  });

  app.post<{ Params: { id: string } }>("/:id/stop", async (request, reply) => {
    return withService(request.params.id, reply, async (service) => service.stop());
  });

  app.post<{ Params: { id: string } }>("/:id/restart", async (request, reply) => {
    return withService(request.params.id, reply, async (service) => service.restart());
  });

  app.get<{ Params: { id: string }, Querystring: LogsQuery }>("/:id/logs", async (request, reply) => {
    return withService(request.params.id, reply, async (service) => {
      const sinceId = request.query.sinceId ? Number(request.query.sinceId) : undefined;
      return { logs: service.getLogs(sinceId) };
    });
  });

  app.get<{ Params: { id: string }, Querystring: { page?: string, limit?: string } }>("/:id/logs/history", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const page = Math.max(1, parseInt(request.query.page || "1", 10));
    const limit = Math.max(1, Math.min(500, parseInt(request.query.limit || "100", 10)));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.serverLog.findMany({
        where: { serverId: id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.serverLog.count({ where: { serverId: id } })
    ]);

    return { logs, page, limit, total, totalPages: Math.ceil(total / limit) };
  });

  app.post<{ Params: { id: string }, Body: CommandBody }>("/:id/command", async (request, reply) => {
    const command = request.body?.command;
    if (typeof command !== "string") {
      return reply.code(400).send({ error: "COMMAND_REJECTED", message: "String command required" });
    }
    return withService(request.params.id, reply, async (service) => service.sendCommand(command));
  });

  // ── File Browser ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string }, Querystring: FilesQuery }>("/:id/files", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const serverRoot = server.path;
    const requestedRelPath = request.query.path ?? ".";

    // Seguridad: resolver y asegurar que la ruta queda dentro del directorio del servidor
    const resolvedPath = path.resolve(serverRoot, requestedRelPath);
    if (!resolvedPath.startsWith(path.resolve(serverRoot))) {
      return reply.code(403).send({ error: "Access denied: path traversal detected" });
    }

    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        return reply.code(400).send({ error: "Path is not a directory" });
      }

      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      const items = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(resolvedPath, entry.name);
          const relPath = path.relative(serverRoot, fullPath).replace(/\\/g, "/");
          let size = 0;
          let modified = "";
          try {
            const s = await fs.stat(fullPath);
            size = s.size;
            modified = s.mtime.toISOString();
          } catch { }
          return {
            name: entry.name,
            path: relPath,
            type: entry.isDirectory() ? "dir" : "file",
            size,
            sizeFormatted: entry.isFile() ? formatBytes(size) : null,
            modified,
            extension: entry.isFile() ? path.extname(entry.name).toLowerCase() : null
          };
        })
      );

      // Ordenar: carpetas primero, luego archivos
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const relCurrentPath = path.relative(serverRoot, resolvedPath).replace(/\\/g, "/") || ".";
      const parentPath = resolvedPath === path.resolve(serverRoot)
        ? null
        : path.relative(serverRoot, path.dirname(resolvedPath)).replace(/\\/g, "/") || ".";

      return {
        currentPath: relCurrentPath,
        parentPath,
        serverExists: true,
        items
      };
    } catch (e: any) {
      if (e.code === "ENOENT") {
        // El directorio del servidor aún no existe (nunca se ha iniciado)
        return {
          currentPath: ".",
          parentPath: null,
          serverExists: false,
          items: []
        };
      }
      throw e;
    }
  });
}
