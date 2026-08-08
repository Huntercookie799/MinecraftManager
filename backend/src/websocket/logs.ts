import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { MinecraftService } from "../services/MinecraftService";
import type { LogEntry } from "../types/server";

export async function registerLogSocket(app: FastifyInstance, minecraft: MinecraftService): Promise<void> {
  app.get("/logs", { websocket: true }, (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: "snapshot", logs: minecraft.getLogs() }));

    const sendLog = (entry: LogEntry) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "log", log: entry }));
      }
    };

    minecraft.on("log", sendLog);
    socket.on("close", () => minecraft.off("log", sendLog));
  });
}
