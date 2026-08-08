import type { FastifyInstance, FastifyReply } from "fastify";
import { MinecraftService, MinecraftServiceError } from "../services/MinecraftService";

interface LogsQuery {
  sinceId?: string;
}

interface CommandBody {
  command?: string;
}

export async function registerServerRoutes(app: FastifyInstance, minecraft: MinecraftService): Promise<void> {
  app.get("/", async () => minecraft.getStatus());

  app.get("/status", async () => minecraft.getStatus());

  app.post("/start", async (_request, reply) => {
    return runMinecraftAction(reply, () => minecraft.start());
  });

  app.post("/stop", async (_request, reply) => {
    return runMinecraftAction(reply, () => minecraft.stop());
  });

  app.post("/restart", async (_request, reply) => {
    return runMinecraftAction(reply, () => minecraft.restart());
  });

  app.get<{ Querystring: LogsQuery }>("/logs", async (request) => {
    const sinceId = request.query.sinceId ? Number(request.query.sinceId) : undefined;
    return { logs: minecraft.getLogs(sinceId) };
  });

  app.post<{ Body: CommandBody }>("/command", async (request, reply) => {
    const command = request.body?.command;

    if (typeof command !== "string") {
      return reply.code(400).send({
        error: "COMMAND_REJECTED",
        message: "Request body must include a string command."
      });
    }

    return runMinecraftAction(reply, () => Promise.resolve(minecraft.sendCommand(command)));
  });
}

async function runMinecraftAction<T>(reply: FastifyReply, action: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof MinecraftServiceError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message
      });
    }

    throw error;
  }
}
