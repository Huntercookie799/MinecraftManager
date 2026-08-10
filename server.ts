import { buildApp } from "./bootstrap/app";
import { env } from "./config/env";
import { prisma } from "./app/Models/prisma";
import { serverManager } from "./app/Services/ServerManager";

async function main(): Promise<void> {
  const app = await buildApp();

  // Adoptar procesos de Minecraft que sobrevivieron a un reinicio anterior del
  // panel (proceso huérfano): reconstruye estado y sigue sus logs por archivo.
  try {
    const servers = await prisma.server.findMany();
    for (const s of servers) {
      serverManager.getService({
        id: s.id,
        name: s.name,
        directory: s.path,
        port: s.port,
        memory: s.memory,
        version: s.version ?? undefined
      });
    }
    await serverManager.adoptAll();
  } catch (error) {
    console.error("[server] No se pudieron adoptar procesos huérfanos:", error);
  }

  // Shutdown graceful: detener los servidores gestionados para no dejar JVMs huérfanas
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[server] ${signal} recibido — deteniendo servidores...`);
      void serverManager.stopAll().finally(() => process.exit(0));
    });
  }

  try {
    await app.listen({
      host: env.host,
      port: env.port
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
