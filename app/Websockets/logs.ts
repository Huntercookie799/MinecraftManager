import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { serverManager } from "../Services/ServerManager";
import type { LogEntry } from "../Types/server";
import { prisma } from "../Models/prisma";

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

    const service = serverManager.getService({
      id: server.id,
      name: server.name,
      directory: server.path,
      port: server.port,
      memory: server.memory
    });

    // Enviar snapshot de logs actuales
    socket.send(JSON.stringify({ type: "snapshot", logs: service.getLogs() }));
    // Enviar estado actual inmediatamente
    socket.send(JSON.stringify({ type: "status", data: service.getStatus() }));

    // ── Keepalive: ping cada 30s para evitar timeout de Render (60s) ──
    const keepAlive = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }, 30_000);

    // ── Reenviar logs nuevos ──
    const sendLog = (entry: LogEntry) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "log", log: entry }));
      }
    };

    // ── Enviar status solo cuando cambia el estado del servidor ──
    // No lo enviamos en cada log para no saturar el canal.
    let lastState = service.getStatus().status;
    const sendStatusIfChanged = (_entry: LogEntry) => {
      if (socket.readyState !== socket.OPEN) return;
      const current = service.getStatus();
      if (current.status !== lastState) {
        lastState = current.status;
        socket.send(JSON.stringify({ type: "status", data: current }));
      }
    };

    service.on("log", sendLog);
    service.on("log", sendStatusIfChanged);

    socket.on("close", () => {
      clearInterval(keepAlive);
      service.off("log", sendLog);
      service.off("log", sendStatusIfChanged);
    });

    // Responder a pings del cliente (por si el cliente también hace ping)
    socket.on("message", (msg: Buffer) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignorar mensajes no JSON (pings nativos de WS)
      }
    });
  });
}
