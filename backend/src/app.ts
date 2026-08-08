import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import bcrypt from "bcrypt";
import Fastify from "fastify";
import path from "node:path";
import { env } from "./config/env";
import { prisma } from "./db/prisma";
import { registerAuthRoutes } from "./routes/auth.routes";
import { registerServerRoutes } from "./routes/server.routes";
import { registerWorldsRoutes } from "./routes/worlds.routes";
import { serverManager } from "./services/ServerManager";
import { registerLogSocket } from "./websocket/logs";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.nodeEnv === "test" ? "silent" : "info"
    }
  });

  await app.register(cors, {
    origin: env.corsOrigin === "*" ? true : env.corsOrigin
  });
  
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 500 * 1024 * 1024 // Limitar a 500MB
    }
  });
  
  await app.register(websocket);
  
  await app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "public"),
    prefix: "/", 
  });

  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || "supersecretkey_change_me_in_production"
  });

  // Verify function
  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      if (request.query && request.query.token) {
        request.headers.authorization = `Bearer ${request.query.token}`;
      }
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "minecraft-manager-backend"
  }));

  await app.register(registerAuthRoutes, { prefix: "/api/auth" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerServerRoutes(server);
  }, { prefix: "/api/server" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerWorldsRoutes(server);
  }, { prefix: "/api/server/:serverId/worlds" });

  await app.register(async (server) => {
    server.addHook("onRequest", (server as any).authenticate);
    await registerLogSocket(server);
  }, { prefix: "/ws" });

  app.addHook("onReady", async () => {
    const adminExists = await prisma.user.findFirst();
    if (!adminExists) {
      app.log.info("No users found. Creating default admin user (admin/admin).");
      const hashedPassword = await bcrypt.hash("admin", 10);
      await prisma.user.create({
        data: {
          username: "admin",
          password: hashedPassword,
          role: "admin"
        }
      });
    }
  });

  app.addHook("onClose", async () => {
    await serverManager.stopAll();
  });

  return app;
}
