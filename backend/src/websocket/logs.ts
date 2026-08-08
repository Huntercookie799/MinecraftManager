import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { serverManager } from "../services/ServerManager";
import type { LogEntry } from "../types/server";
import { prisma } from "../db/prisma";

export async function registerLogSocket(app: FastifyInstance): Promise<void> {
  app.get("/logs", { websocket: true }, async (socket: WebSocket, request: FastifyRequest) => {
    const query = request.query as { serverId?: string };
    if (!query.serverId) {
      socket.send(JSON.stringify({ type: "error", message: "Missing serverId" }));
      socket.close();
      return;
    }

    const serverId = parseInt(query.serverId, 10);
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    
    if (!server) {
      socket.send(JSON.stringify({ type: "error", message: "Server not found" }));
      socket.close();
      return;
    }

    // Get the service instance (initializes offline if not running)
    const service = serverManager.getService({
      id: server.id,
      name: server.name,
      directory: server.path,
      port: server.port,
      memory: server.memory
    });

    // Send current log snapshot
    socket.send(JSON.stringify({ type: "snapshot", logs: service.getLogs() }));

    // Send current status immediately so UI is up to date
    socket.send(JSON.stringify({ type: "status", data: service.getStatus() }));

    // Forward new log entries
    const sendLog = (entry: LogEntry) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "log", log: entry }));
      }
    };

    // Push status update whenever a log line is added (state may have changed)
    const sendStatus = () => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "status", data: service.getStatus() }));
      }
    };

    service.on("log", sendLog);
    service.on("log", sendStatus);

    socket.on("close", () => {
      service.off("log", sendLog);
      service.off("log", sendStatus);
    });
  });
}
