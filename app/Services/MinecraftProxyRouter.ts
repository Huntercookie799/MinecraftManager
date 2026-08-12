import net from "node:net";
import os from "node:os";
import { prisma } from "../Models/prisma";

/**
 * MinecraftProxyRouter
 * ---------------------------------------------------------------------------
 * Reemplaza el modelo "un puerto público por servidor" de PortForwardService
 * por un ÚNICO listener compartido en 80/443 que enruta según el HOSTNAME
 * que el cliente de Minecraft envía en el paquete de Handshake (igual que el
 * SNI de TLS, pero a nivel de protocolo de aplicación de Minecraft).
 *
 *   angellap.server01:443  -> puerto interno 25565 (servidor "AngelLap")
 *   otro.server02:443      -> puerto interno 25566 (servidor "Otro")
 *
 * El cliente NO necesita TLS real: el protocolo va en bytes crudos sobre TCP.
 * ---------------------------------------------------------------------------
 */

interface RouteTarget {
  targetPort: number;
  serverId: number;
}

export class MinecraftProxyRouter {
  private listeners: net.Server[] = [];
  /** hostname (lowercase, sin puerto) -> destino interno */
  private routes = new Map<string, RouteTarget>();
  /** IPs locales de esta máquina (fallback: si el jugador escribe la IP directa) */
  private localIps = new Set<string>();
  /** orden de servidores (para el fallback por IP -> primer servidor) */
  private orderedTargets: RouteTarget[] = [];
  /** estado por puerto público (escuchando / error) */
  private status = new Map<number, { listening: boolean; error?: string }>();

  isListening(port: number): boolean {
    return this.status.get(port)?.listening ?? false;
  }

  getStatus(): { port: number; listening: boolean; error?: string }[] {
    return Array.from(this.status.entries()).map(([port, s]) => ({ port, ...s }));
  }

  /** Carga/recarga la tabla de rutas desde la base de datos. */
  async reloadRoutes(): Promise<void> {
    const servers = await prisma.server.findMany({
      where: { hostname: { not: null } },
      select: { id: true, hostname: true, port: true }
    });

    this.routes.clear();
    this.orderedTargets = [];
    for (const s of servers) {
      if (!s.hostname) continue;
      const host = s.hostname.trim().toLowerCase();
      if (!host) continue;
      const target = { targetPort: s.port, serverId: s.id };
      this.routes.set(host, target);
      this.orderedTargets.push(target);
    }

    // IPs locales: permiten entrar escribiendo la IP directa (ej. 192.168.1.145:443)
    // o localhost, sin depender del hosts file. Enrutan al primer servidor configurado.
    this.localIps.clear();
    this.localIps.add("127.0.0.1");
    this.localIps.add("localhost");
    this.localIps.add("::1");
    for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const iface of ifaces ?? []) {
        if (String(iface.family) === "IPv4") {
          this.localIps.add(iface.address);
        }
      }
    }

    console.log(`[proxy-router] ${this.routes.size} hostname(s) cargados: ${Array.from(this.routes.keys()).join(", ") || "ninguno"} + ${this.localIps.size} IP(s) local(es)`);
  }

  /** Arranca el/los listener(s) públicos. Llamar una sola vez al boot. */
  async start(publicPorts: number[] = [443, 80]): Promise<void> {
    await this.reloadRoutes();

    for (const publicPort of publicPorts) {
      const server = net.createServer((socket) => this.handleConnection(socket));
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(publicPort, "0.0.0.0", () => {
            server.removeListener("error", reject);
            resolve();
          });
        });
        this.listeners.push(server);
        this.status.set(publicPort, { listening: true });
        console.log(`[proxy-router] Escuchando en :${publicPort} (routing por hostname)`);
      } catch (e: any) {
        server.close();
        if (e.code === "EADDRINUSE") {
          this.status.set(publicPort, { listening: false, error: `Puerto ${publicPort} ocupado por otro proceso (¿Apache/WAMP?)` });
          console.error(`[proxy-router] :${publicPort} ocupado por otro proceso (¿Apache/WAMP?). No se puede enrutar por ese puerto.`);
        } else if (e.code === "EACCES") {
          this.status.set(publicPort, { listening: false, error: `Permiso denegado para :${publicPort} (<1024): en Linux se necesita root o CAP_NET_BIND_SERVICE` });
          console.error(`[proxy-router] Permiso denegado para :${publicPort} (se necesita root o CAP_NET_BIND_SERVICE)`);
        } else {
          this.status.set(publicPort, { listening: false, error: e.message });
          console.error(`[proxy-router] Error al escuchar en :${publicPort}: ${e.message}`);
        }
      }
    }
  }

  async stop(): Promise<void> {
    await Promise.all(
      this.listeners.map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
    );
    this.listeners = [];
    this.status.clear();
  }

  private handleConnection(socket: net.Socket): void {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let routed = false;
    const MAX_HANDSHAKE_BYTES = 512;

    const onData = (data: Buffer) => {
      chunks.push(data);
      totalLength += data.length;

      // Ya enrutado: el pipe se encarga de los datos nuevos; acá solo seguimos
      // acumulando lo que llegue mientras se establece la conexión con el
      // upstream (para escribirlo todo de una cuando conecte).
      if (routed) return;

      const buffered = Buffer.concat(chunks, totalLength);
      const parsed = tryParseHandshake(buffered);

      if (parsed === "incomplete") {
        if (totalLength > MAX_HANDSHAKE_BYTES) {
          socket.destroy();
        }
        return;
      }

      if (parsed === "invalid") {
        socket.destroy();
        return;
      }

      routed = true;

      const hostname = parsed.hostname.toLowerCase();
      let route = this.routes.get(hostname);

      // Fallback: si el jugador escribió la IP de esta máquina (o localhost),
      // enrutar al primer servidor configurado — no depender del hosts file.
      if (!route && this.localIps.has(hostname) && this.orderedTargets.length > 0) {
        route = this.orderedTargets[0];
        console.log(`[proxy-router] IP local "${parsed.hostname}" -> servidor ${route.serverId} (puerto ${route.targetPort})`);
      }

      if (!route) {
        console.warn(`[proxy-router] Hostname desconocido: "${parsed.hostname}" — cerrando conexión`);
        socket.end();
        return;
      }

      const upstream = net.connect(route.targetPort, "127.0.0.1", () => {
        // IMPORTANTE: escribir TODO lo acumulado (handshake + cualquier dato que
        // llegó mientras se establecía la conexión) y recién ahí entregar el
        // socket al pipe. Si se quitara el listener antes de conectar, los datos
        // que lleguen en esa ventana se descartan (el cliente vanilla manda el
        // login start justo después del handshake y caía siempre en esa ventana,
        // provocando "Tiempo de espera agotado").
        upstream.write(Buffer.concat(chunks, totalLength));
        socket.removeListener("data", onData);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });

      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
    };

    socket.on("data", onData);
    socket.on("error", () => socket.destroy());
  }
}

// ---------------------------------------------------------------------------
// Parsing mínimo del protocolo de Minecraft (Handshake, packet ID 0x00)
// ---------------------------------------------------------------------------

type HandshakeResult = { hostname: string; port: number; nextState: number } | "incomplete" | "invalid";

function readVarInt(buf: Buffer, offset: number): { value: number; next: number } | null {
  let value = 0;
  let position = 0;
  let currentOffset = offset;

  while (true) {
    if (currentOffset >= buf.length) return null;
    const byte = buf[currentOffset++];
    value |= (byte & 0x7f) << position;
    if ((byte & 0x80) === 0) break;
    position += 7;
    if (position >= 32) return null;
  }

  return { value, next: currentOffset };
}

function tryParseHandshake(buf: Buffer): HandshakeResult {
  if (buf.length > 0 && buf[0] === 0xfe) return "invalid";

  const lengthRead = readVarInt(buf, 0);
  if (!lengthRead) return "incomplete";

  const packetEnd = lengthRead.next + lengthRead.value;
  if (buf.length < packetEnd) return "incomplete";

  let offset = lengthRead.next;

  const packetIdRead = readVarInt(buf, offset);
  if (!packetIdRead) return "invalid";
  if (packetIdRead.value !== 0x00) return "invalid";
  offset = packetIdRead.next;

  const protocolRead = readVarInt(buf, offset);
  if (!protocolRead) return "invalid";
  offset = protocolRead.next;

  const addrLenRead = readVarInt(buf, offset);
  if (!addrLenRead) return "invalid";
  offset = addrLenRead.next;

  if (offset + addrLenRead.value > packetEnd) return "invalid";
  let hostname = buf.toString("utf8", offset, offset + addrLenRead.value);
  offset += addrLenRead.value;

  const nullIndex = hostname.indexOf("\0");
  if (nullIndex !== -1) hostname = hostname.slice(0, nullIndex);

  if (offset + 2 > packetEnd) return "invalid";
  const port = buf.readUInt16BE(offset);
  offset += 2;

  const nextStateRead = readVarInt(buf, offset);
  if (!nextStateRead) return "invalid";
  const nextState = nextStateRead.value;

  return { hostname, port, nextState };
}

export const minecraftProxyRouter = new MinecraftProxyRouter();
