import type { FastifyInstance } from "fastify";
import { prisma } from "../../Models/prisma";
import { serverManager } from "../../Services/ServerManager";
import { systemMonitor } from "../../Services/SystemMonitorService";
import { minecraftProxyRouter } from "../../Services/MinecraftProxyRouter";
import { getLanIp, getNetworkInterfaces } from "../../Utils/network";

/**
 * Vista de supervisión: estado de red (IP LAN, interfaces, hostnames que
 * rutea el proxy) + rendimiento (CPU/RAM del sistema y por servidor).
 */
export async function registerMonitorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/overview", async () => {
    const servers = await prisma.server.findMany();

    // Mismo patrón que GET /api/server: materializar el servicio (adopta el
    // proceso si sobrevivió al panel) y devolver su estado real.
    const rows = await Promise.all(
      servers.map(async (s) => {
        const service = serverManager.getService({
          id: s.id,
          name: s.name,
          directory: s.path,
          port: s.port,
          memory: s.memory,
          version: s.version ?? undefined,
          motd: s.motd ?? undefined,
          mcIcon: s.mcIcon ?? undefined,
          softwareType: s.softwareType,
          onlineMode: s.onlineMode ?? true
        });
        await service.tryAdopt();
        return { server: s, status: service.getStatus() };
      })
    );

    const pids = rows.map((r) => r.status.pid).filter((p): p is number => !!p);
    const [system, processStats] = await Promise.all([
      systemMonitor.getSystemStats(),
      systemMonitor.getProcessStats(pids)
    ]);

    return {
      system,
      network: {
        lanIp: getLanIp(),
        interfaces: getNetworkInterfaces(),
        router: minecraftProxyRouter.getStatus()
      },
      servers: rows.map(({ server, status }) => ({
        id: server.id,
        name: server.name,
        hostname: server.hostname,
        port: server.port,
        memory: server.memory,
        onlineMode: server.onlineMode,
        status,
        process: status.pid ? (processStats.get(status.pid) ?? null) : null
      }))
    };
  });
}
