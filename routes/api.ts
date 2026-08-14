import type { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "../app/Http/Controllers/AuthController";
import { registerPublicServerRoutes, registerServerRoutes } from "../app/Http/Controllers/ServerController";
import { registerWorldsRoutes } from "../app/Http/Controllers/WorldController";
import { registerMonitorRoutes } from "../app/Http/Controllers/MonitorController";
import { registerUtilsRoutes } from "../app/Http/Controllers/UtilsController";
import { registerStorageRoutes } from "../app/Http/Controllers/StorageController";

export async function registerApiRoutes(app: FastifyInstance) {
  await app.register(registerAuthRoutes, { prefix: "/auth" });

  // Rutas públicas (sin auth): lo mínimo para que los scripts de los
  // jugadores obtengan la IP LAN y los hostnames sin credenciales.
  await app.register(registerPublicServerRoutes, { prefix: "/server" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerServerRoutes(server);
  }, { prefix: "/server" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerWorldsRoutes(server);
  }, { prefix: "/server/:serverId/worlds" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerMonitorRoutes(server);
  }, { prefix: "/monitor" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerUtilsRoutes(server);
  }, { prefix: "/utils" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerStorageRoutes(server);
  }, { prefix: "/storage" });
}
