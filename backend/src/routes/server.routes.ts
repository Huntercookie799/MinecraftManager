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

export async function registerServerRoutes(app: FastifyInstance): Promise<void> {
  // List all servers
  app.get("/", async () => {
    const servers = await prisma.server.findMany();
    const result = servers.map(s => {
      const service = serverManager.getServiceById(s.id);
      return {
        ...s,
        status: service ? service.getStatus() : { status: "OFFLINE", players: 0, maxPlayers: 20, uptime: 0 }
      };
    });
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
    return withService(request.params.id, reply, async (service) => service.getStatus());
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
}
