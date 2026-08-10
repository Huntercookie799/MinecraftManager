import net from "node:net";

interface Forwarder {
  server: net.Server;
  publicPort: number;
  targetPort: number;
}

/**
 * Expone un servidor de Minecraft en un puerto público (p.ej. 80/443) mediante
 * un proxy TCP puro que reenvía al puerto interno del servidor, sin necesidad
 * de reiniciarlo. Útil cuando la red solo permite conexiones entrantes por 80/443.
 */
export class PortForwardService {
  private forwarders = new Map<number, Forwarder>();

  isRunning(serverId: number): boolean {
    return this.forwarders.has(serverId);
  }

  getInfo(serverId: number): { publicPort: number; targetPort: number } | null {
    const forwarder = this.forwarders.get(serverId);
    return forwarder ? { publicPort: forwarder.publicPort, targetPort: forwarder.targetPort } : null;
  }

  async start(serverId: number, publicPort: number, targetPort: number): Promise<void> {
    await this.stop(serverId);

    if (publicPort === targetPort) {
      throw Object.assign(new Error("El puerto público no puede ser igual al puerto del servidor"), { code: "SAME_PORT" });
    }
    if (publicPort < 1 || publicPort > 65535) {
      throw Object.assign(new Error("Puerto público inválido"), { code: "INVALID_PORT" });
    }

    const server = net.createServer((socket) => {
      const upstream = net.connect(targetPort, "127.0.0.1");
      socket.pipe(upstream);
      upstream.pipe(socket);
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(publicPort, "0.0.0.0", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    this.forwarders.set(serverId, { server, publicPort, targetPort });
  }

  async stop(serverId: number): Promise<void> {
    const forwarder = this.forwarders.get(serverId);
    if (!forwarder) return;
    this.forwarders.delete(serverId);
    await new Promise<void>((resolve) => forwarder.server.close(() => resolve()));
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.forwarders.keys()).map((id) => this.stop(id)));
  }
}

export const portForwardService = new PortForwardService();
