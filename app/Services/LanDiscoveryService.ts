import dgram from "node:dgram";
import { prisma } from "../Models/prisma";
import { getLanIp } from "../Utils/network";

export const DISCOVERY_PORT = 45678;
export const DISCOVERY_MAGIC = "MCSYNC_DISCOVER";

/**
 * LanDiscoveryService
 * ---------------------------------------------------------------------------
 * Permite que los scripts de sincronización de hosts de los jugadores
 * (minecraft-hosts-auto) encuentren la IP actual del panel aunque cambie de
 * red: el script manda un broadcast UDP "MCSYNC_DISCOVER" a la LAN y este
 * servicio responde con { lanIp, hostnames }. Sin esto, el script guarda la
 * IP embebida al descargarse y queda vieja cuando el DHCP cambia la IP.
 *
 * No expone nada que no sea ya público: /api/server/hostnames/public devuelve
 * la misma información sin autenticación por diseño (para los scripts).
 */
export class LanDiscoveryService {
  private socket: dgram.Socket | null = null;

  start(): void {
    if (this.socket) return;
    const socket = dgram.createSocket("udp4");

    socket.on("error", (err) => {
      console.error(`[lan-discovery] error: ${err.message}`);
    });

    socket.on("message", async (msg, rinfo) => {
      const text = msg.toString("utf8").trim();
      if (text !== DISCOVERY_MAGIC) return;

      try {
        const servers = await prisma.server.findMany({
          where: { hostname: { not: null } },
          select: { hostname: true }
        });
        const payload = Buffer.from(
          JSON.stringify({
            lanIp: getLanIp(),
            hostnames: servers.map((s) => s.hostname).filter((h): h is string => !!h)
          }),
          "utf8"
        );
        socket.send(payload, rinfo.port, rinfo.address, (err) => {
          if (err) console.error(`[lan-discovery] send error: ${err.message}`);
        });
      } catch (e: any) {
        console.error(`[lan-discovery] error al responder: ${e.message}`);
      }
    });

    socket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
      console.log(`[lan-discovery] escuchando en UDP :${DISCOVERY_PORT} (broadcast MCSYNC_DISCOVER)`);
    });
    this.socket = socket;
  }

  stop(): void {
    try {
      this.socket?.close();
    } catch {
      /* ignorar */
    }
    this.socket = null;
  }
}

export const lanDiscovery = new LanDiscoveryService();
