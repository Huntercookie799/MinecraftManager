import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import { serverManager } from "../services/ServerManager";
import { MinecraftServiceError } from "../services/MinecraftService";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import fs from "node:fs/promises";

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
}

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
  // List all servers
  app.get("/", async () => {
    const servers = await prisma.server.findMany();
    const result = await Promise.all(servers.map(async s => {
      const service = serverManager.getServiceById(s.id);
      const worldExists = await checkWorldExists(s.path);
      return {
        ...s,
        worldExists,
        status: service ? service.getStatus() : { status: "OFFLINE", players: 0, maxPlayers: 20, uptime: 0 }
      };
    }));
    return { servers: result };
  });

  // Create a server
  app.post<{ Body: CreateServerBody }>("/", async (request, reply) => {
    const { name, memory, port } = request.body;
    if (!name) return reply.code(400).send({ error: "Missing name" });

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
          path: serverPath
        }
      });
      return { success: true, server };
    } catch (e: any) {
      if (e.code === 'P2002') return reply.code(400).send({ error: "Name or port already exists" });
      throw e;
    }
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
      memory: server.memory
    });
    
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
      memory: server.memory
    });

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
