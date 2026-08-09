import type { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "../app/Http/Controllers/AuthController";
import { registerServerRoutes } from "../app/Http/Controllers/ServerController";
import { registerWorldsRoutes } from "../app/Http/Controllers/WorldController";

export async function registerApiRoutes(app: FastifyInstance) {
  await app.register(registerAuthRoutes, { prefix: "/auth" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerServerRoutes(server);
  }, { prefix: "/server" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerWorldsRoutes(server);
  }, { prefix: "/server/:serverId/worlds" });
}
