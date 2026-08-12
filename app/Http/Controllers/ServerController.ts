import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import os from "node:os";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { serverManager } from "../../Services/ServerManager";
import { MinecraftServiceError } from "../../Services/MinecraftService";
import { prisma } from "../../Models/prisma";
import { env } from "../../../config/env";
import fs from "node:fs/promises";
import { S3SyncService } from "../../Services/S3SyncService";
import { jarManager } from "../../Services/JarManager";
import { Jimp } from "jimp";
import { addonSearchService } from "../../Services/AddonSearchService";
import { portForwardService } from "../../Services/PortForwardService";
import { minecraftProxyRouter } from "../../Services/MinecraftProxyRouter";
import { getLanIp } from "../../Utils/network";

interface LogsQuery {
  sinceId?: string;
}

interface CommandBody {
  command?: string;
}

interface CreateServerBody {
  name: string;
  memory?: string;
  port?: number;
  version?: string;
  hostname?: string;
  softwareType?: string;
}

const DEFAULT_MC_VERSION = "1.21.8";

interface FilesQuery {
  path?: string;
}

// ─── Helper: format bytes ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ─── Helper: check if world exists ───────────────────────────────────────────

async function checkWorldExists(serverPath: string, worldName = "world"): Promise<boolean> {
  try {
    await fs.access(path.join(serverPath, worldName));
    return true;
  } catch {
    return false;
  }
}

/** Endpoint PÚBLICO (sin auth): IP LAN + hostnames configurados. Lo usa el
 *  script de sincronización que se descarga para las PCs de los jugadores
 *  (no expone credenciales ni datos sensibles: solo IP y nombres de host). */
export async function registerPublicServerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/hostnames/public", async () => {
    const servers = await prisma.server.findMany({
      where: { hostname: { not: null } },
      select: { hostname: true }
    });
    return {
      lanIp: getLanIp(),
      hostnames: servers.map(s => s.hostname).filter((h): h is string => !!h)
    };
  });
}

export async function registerServerRoutes(app: FastifyInstance): Promise<void> {
  // Global R2 Files
  app.get<{ Params: { id: string } }>("/:id/s3/files", async (request, reply) => {
    try {
      const serverId = request.params.id;
      const s3 = new S3SyncService();
      if (!s3.isConfigured) {
        return reply.code(400).send({ error: "S3 Sync is not configured" });
      }
      
      const prefix = `${serverId}/`;
      const objects = await s3.listObjects(prefix);
      
      const items = objects.map(obj => ({
        name: obj.key?.replace(prefix, '') || '', // Remover el prefijo para mostrar solo el nombre del archivo
        path: obj.key,
        type: "file",
        size: obj.size,
        sizeFormatted: formatBytes(obj.size || 0),
        modified: obj.lastModified ? obj.lastModified.toISOString() : "",
        extension: path.extname(obj.key || "").toLowerCase()
      }));

      return {
        currentPath: `R2 Bucket (${prefix})`,
        parentPath: null,
        serverExists: true,
        items
      };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.get<{ Params: { id: string } }>("/:id/players", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Servidor no encontrado" });

    try {
      const players = await prisma.$queryRaw<any[]>`
        SELECT name, playtimeSeconds, lastSeen, createdAt
        FROM serverplayer
        WHERE serverId = ${id}
        ORDER BY playtimeSeconds DESC
      `;
      return { success: true, players };
    } catch (e) {
      console.error("Error fetching historical players", e);
      return reply.code(500).send({ error: "Error al obtener jugadores" });
    }
  });

  // POST /:id/skins
  app.post<{ Params: { id: string } }>("/:id/skins", async (request, reply) => {
    try {
      const serverId = parseInt(request.params.id, 10);
      const svc = serverManager.getServiceById(serverId);
      if (!svc || svc.getStatus().status !== "ONLINE") {
        return reply.code(400).send({ error: "El servidor no está ejecutándose o no se encontró." });
      }

      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: "No se subió ningún archivo" });
      }

      const username = (data.fields.username as any)?.value as string;
      if (!username) {
        return reply.code(400).send({ error: "El username es obligatorio" });
      }

      const fileBuffer = await data.toBuffer();

      const formData = new FormData();
      formData.append("file", new Blob([new Uint8Array(fileBuffer)], { type: data.mimetype }), data.filename);
      formData.append("visibility", "1"); // 1 = private

      const response = await fetch("https://api.mineskin.org/generate/upload", {
        method: "POST",
        body: formData,
        headers: {
          "User-Agent": "MinecraftManager/1.0"
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error en MineSkin API: ${response.status} ${errorText}`);
      }

      const json = await response.json();
      const { value, signature } = (json as any).data.texture;

      // Inyectar comando de SkinRestorer
      svc.sendCommand(`skin custom ${username} ${value} ${signature}`);

      return { success: true, message: `Skin aplicada exitosamente a ${username}.` };
    } catch (e: any) {
      console.error("[ServerController] Error subiendo skin:", e);
      return reply.code(500).send({ error: e.message });
    }
  });

  // POST /:id/install-skinrestorer
  app.post<{ Params: { id: string } }>("/:id/install-skinrestorer", async (request, reply) => {
    try {
      const serverId = parseInt(request.params.id, 10);
      const server = await prisma.server.findUnique({ where: { id: serverId } });
      if (!server) return reply.code(404).send({ error: "Server no encontrado" });

      const pluginsDir = path.join(server.path, "plugins");
      await fs.mkdir(pluginsDir, { recursive: true });
      const destFile = path.join(pluginsDir, "SkinRestorer.jar");

      // Buscar la última versión en GitHub
      const res = await fetch("https://api.github.com/repos/SkinRestorer/SkinRestorer/releases/latest", {
        headers: { "User-Agent": "MinecraftManager/1.0" }
      });
      if (!res.ok) throw new Error("No se pudo contactar con GitHub API");
      const json = await res.json();
      const asset = (json as any).assets?.find((a: any) => a.name.endsWith(".jar"));
      if (!asset) throw new Error("No se encontró el archivo .jar en GitHub");

      // Descargar el archivo
      const downloadRes = await fetch(asset.browser_download_url);
      if (!downloadRes.ok) throw new Error(`Fallo al descargar: ${downloadRes.statusText}`);
      
      const buffer = await downloadRes.arrayBuffer();
      await fs.writeFile(destFile, Buffer.from(buffer));

      return { success: true, message: "SkinRestorer instalado correctamente en la carpeta plugins." };
    } catch (e: any) {
      console.error("[ServerController] Error instalando SkinRestorer:", e);
      return reply.code(500).send({ error: e.message });
    }
  });



  // List all servers
  // List available Minecraft versions (Purpur)
  app.get("/versions", async () => {
    const versions = await jarManager.listVersions();
    return { versions };
  });

  // Estado del router por hostname (puertos 80/443)
  app.get("/router/status", async () => {
    return { listeners: minecraftProxyRouter.getStatus() };
  });

  // Lista de hostnames configurados + IP LAN + estado del router
  app.get("/hostnames", async () => {
    const servers = await prisma.server.findMany({
      where: { hostname: { not: null } },
      select: { id: true, name: true, hostname: true, port: true, version: true, path: true, memory: true, motd: true, mcIcon: true, onlineMode: true, softwareType: true, syncWithS3: true }
    });

    const items = await Promise.all(servers.map(async (s) => {
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
        onlineMode: s.onlineMode ?? true,
        syncWithS3: s.syncWithS3 ?? true
      });
      await service.tryAdopt();
      const status = service.getStatus();
      return {
        id: s.id,
        name: s.name,
        hostname: s.hostname,
        port: s.port,
        version: s.version,
        status: status.status,
        players: status.players,
        maxPlayers: status.maxPlayers
      };
    }));

    return {
      lanIp: getLanIp(),
      listeners: minecraftProxyRouter.getStatus(),
      hostnames: items
    };
  });

  app.get("/", async () => {
    const servers = await prisma.server.findMany();
    const result = await Promise.all(servers.map(async s => {
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
      const worldExists = await checkWorldExists(s.path);
      return {
        ...s,
        worldExists,
        status: service.getStatus()
      };
    }));
    return { servers: result };
  });

  // Create a server
  app.post<{ Body: CreateServerBody }>("/", async (request, reply) => {
    const { name, memory, port, version } = request.body;
    if (!name) return reply.code(400).send({ error: "Missing name" });

    const mcVersion = version || DEFAULT_MC_VERSION;
    if (!/^\d+\.\d+(\.\d+)?$/.test(mcVersion)) {
      return reply.code(400).send({ error: "Invalid Minecraft version format" });
    }

    // Assign port
    let assignedPort = port;
    if (!assignedPort) {
      const lastServer = await prisma.server.findFirst({ orderBy: { port: 'desc' } });
      assignedPort = lastServer ? lastServer.port + 1 : 25565;
    }

    const folderName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const serverPath = path.join(process.cwd(), "minecraft_servers", folderName);

    try {
      const server = await prisma.server.create({
        data: {
          name,
          port: assignedPort,
          memory: memory || "2G",
          version: mcVersion,
          path: serverPath,
          hostname: request.body.hostname?.trim() ? request.body.hostname.trim().toLowerCase() : null,
          softwareType: request.body.softwareType || "purpur",
        }
      });
      await minecraftProxyRouter.reloadRoutes();
      return { success: true, server };
    } catch (e: any) {
      if (e.code === 'P2002') return reply.code(400).send({ error: "Name or port already exists" });
      throw e;
    }
  });

  // Metadatos rápidos de un servidor (sin adopción ni escaneo de disco) —
  // para que el panel pinte nombre/avatar al instante sin esperar el listado completo.
  app.get<{ Params: { id: string } }>("/:id/meta", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });
    return {
      id: server.id,
      name: server.name,
      port: server.port,
      memory: server.memory,
      version: server.version,
      avatar: server.avatar,
      accentColor: server.accentColor,
      hostname: server.hostname,
      forwardPort: server.forwardPort,
      motd: server.motd,
      mcIcon: server.mcIcon
    };
  });

  // Update server settings (name, avatar, accent color, MOTD, server icon)
  app.put<{ Params: { id: string } }>("/:id/settings", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const contentType = request.headers["content-type"] || "";
    const updateData: any = {};
    let avatarUrl: string | null = null;
    let iconUrl: string | null = null;

    const serverIconsDir = path.join(__dirname, "..", "..", "..", "public", "server-icons");
    await fs.mkdir(serverIconsDir, { recursive: true });

    if (contentType.includes("multipart/form-data")) {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const field = part.fieldname;
          const ext = path.extname(part.filename || "") || ".png";
          if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext.toLowerCase())) {
            return reply.code(400).send({ error: "Invalid image format. Allowed: png, jpg, jpeg, gif, webp" });
          }
          const fileName = `server_${id}_${field}${ext}`;
          const dest = path.join(serverIconsDir, fileName);
          await pipeline(part.file, createWriteStream(dest));

          if (field === "avatar") {
            avatarUrl = `/server-icons/${fileName}`;
            if (server.avatar) {
              await fs.rm(path.join(__dirname, "..", "..", "..", "public", server.avatar), { force: true }).catch(() => {});
            }
          } else if (field === "icon") {
            // server-icon.png debe ser 64x64 PNG — redimensionar con Jimp
            try {
              const image = await Jimp.read(dest);
              image.resize({ w: 64, h: 64 });
              await image.write(dest as any);
            } catch (e) {
              return reply.code(400).send({ error: "Imagen de icono inválida (se requiere PNG/JPG)" });
            }
            iconUrl = `/server-icons/${fileName}`;
            if (server.mcIcon) {
              await fs.rm(path.join(__dirname, "..", "..", "..", "public", server.mcIcon), { force: true }).catch(() => {});
            }
          }
        } else {
          // Campo de texto del formulario
          if (part.fieldname === "name" && part.value) updateData.name = String(part.value);
          if (part.fieldname === "accentColor" && part.value) updateData.accentColor = String(part.value);
          if (part.fieldname === "motd" && part.value !== undefined) updateData.motd = String(part.value);
          if (part.fieldname === "removeIcon" && part.value) {
            if (server.mcIcon) {
              await fs.rm(path.join(__dirname, "..", "..", "..", "public", server.mcIcon), { force: true }).catch(() => {});
            }
            updateData.mcIcon = null;
          }
        }
      }
    }

    // Accept JSON body for name / accentColor / motd / onlineMode update
    if (contentType.includes("application/json")) {
      const body = request.body as any || {};
      if (body.name && body.name !== server.name) updateData.name = body.name;
      if (body.accentColor) updateData.accentColor = body.accentColor;
      if (body.motd !== undefined) updateData.motd = String(body.motd);
      if (typeof body.onlineMode === "boolean") updateData.onlineMode = body.onlineMode;
      if (typeof body.syncWithS3 === "boolean") updateData.syncWithS3 = body.syncWithS3;
    }

    // ── Validaciones ──────────────────────────────────────────────────────
    if (updateData.name) {
      const existing = await prisma.server.findUnique({ where: { name: updateData.name } });
      if (existing && existing.id !== id) {
        return reply.code(409).send({ error: "A server with that name already exists" });
      }
    }
    if (updateData.accentColor && !/^#[0-9a-fA-F]{6}$/.test(updateData.accentColor)) {
      return reply.code(400).send({ error: "Invalid accent color. Use hex format e.g. #FF55FF" });
    }
    if (updateData.motd !== undefined) {
      const motd = String(updateData.motd);
      if (motd.length > 600) return reply.code(400).send({ error: "MOTD demasiado largo (máx. 600 caracteres)" });
      updateData.motd = motd.trim() === "" ? null : motd;
    }

    if (avatarUrl) updateData.avatar = avatarUrl;
    if (iconUrl) updateData.mcIcon = iconUrl;

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ error: "No fields to update" });
    }

    const updated = await prisma.server.update({ where: { id }, data: updateData });
    return { success: true, server: updated };
  });

  // Delete a server
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    await portForwardService.stop(id);
    serverManager.removeService(id);
    await prisma.server.delete({ where: { id } });
    await fs.rm(server.path, { recursive: true, force: true }).catch(() => {});
    await minecraftProxyRouter.reloadRoutes();
    
    return { success: true };
  });

  // ── Port Forwarding (exponer en 80/443 sin reiniciar) ────────────────────
  app.get<{ Params: { id: string } }>("/:id/forward", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });
    const info = portForwardService.getInfo(id);
    return {
      configuredPort: server.forwardPort,
      active: !!info,
      publicPort: info?.publicPort ?? null,
      targetPort: info?.targetPort ?? server.port
    };
  });

  app.post<{ Params: { id: string }, Body: { publicPort?: number } }>("/:id/forward", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const publicPort = Number(request.body?.publicPort);
    if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) {
      return reply.code(400).send({ error: "Puerto público inválido" });
    }
    if (publicPort === server.port) {
      return reply.code(400).send({ error: "El puerto público no puede ser igual al puerto del servidor" });
    }

    try {
      await portForwardService.start(id, publicPort, server.port);
    } catch (e: any) {
      if (e.code === "EADDRINUSE") {
        return reply.code(409).send({ error: `El puerto ${publicPort} ya está en uso por otro proceso` });
      }
      if (e.code === "EACCES") {
        return reply.code(403).send({ error: `Permiso denegado para el puerto ${publicPort} (<1024): en Linux se necesita root o CAP_NET_BIND_SERVICE` });
      }
      return reply.code(500).send({ error: e.message });
    }

    await prisma.server.update({ where: { id }, data: { forwardPort: publicPort } });
    return { success: true, publicPort, targetPort: server.port };
  });

  app.delete<{ Params: { id: string } }>("/:id/forward", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });
    await portForwardService.stop(id);
    await prisma.server.update({ where: { id }, data: { forwardPort: null } });
    return { success: true };
  });

  // ── Hostname Routing (varios servidores detrás del mismo 80/443) ─────────
  app.get<{ Params: { id: string } }>("/:id/hostname", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });
    return {
      hostname: server.hostname,
      listeners: minecraftProxyRouter.getStatus()
    };
  });

  app.put<{ Params: { id: string }, Body: { hostname?: string } }>("/:id/hostname", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const raw = (request.body?.hostname ?? "").trim().toLowerCase();
    if (raw === "") {
      await prisma.server.update({ where: { id }, data: { hostname: null } });
      await minecraftProxyRouter.reloadRoutes();
      return { success: true, hostname: null };
    }

    if (!/^[a-z0-9][a-z0-9.-]{0,253}$/.test(raw)) {
      return reply.code(400).send({ error: "Hostname inválido. Ej: angellap.server01 (letras, números, puntos y guiones)" });
    }
    if (raw.includes("..")) {
      return reply.code(400).send({ error: "Hostname inválido: no puede tener puntos consecutivos" });
    }

    const existing = await prisma.server.findUnique({ where: { hostname: raw } });
    if (existing && existing.id !== id) {
      return reply.code(409).send({ error: `El hostname "${raw}" ya está asignado al servidor ${existing.name}` });
    }

    await prisma.server.update({ where: { id }, data: { hostname: raw } });
    await minecraftProxyRouter.reloadRoutes();
    return { success: true, hostname: raw };
  });

  app.delete<{ Params: { id: string } }>("/:id/hostname", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });
    await prisma.server.update({ where: { id }, data: { hostname: null } });
    await minecraftProxyRouter.reloadRoutes();
    return { success: true, hostname: null };
  });

  // ── Server Properties ──────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/:id/properties", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const propsPath = path.join(server.path, "server.properties");
    try {
      const data = await fs.readFile(propsPath, "utf-8");
      const props: Record<string, string> = {};
      data.split("\n").forEach((line) => {
        line = line.trim();
        if (!line || line.startsWith("#")) return;
        const idx = line.indexOf("=");
        if (idx > -1) {
          props[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      });
      return { properties: props };
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return { properties: {} };
      }
      return reply.code(500).send({ error: e.message });
    }
  });

  app.put<{ Params: { id: string }, Body: { properties: Record<string, string> } }>("/:id/properties", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const propsPath = path.join(server.path, "server.properties");
    const updates = request.body?.properties || {};

    let lines: string[] = [];
    try {
      const data = await fs.readFile(propsPath, "utf-8");
      lines = data.split("\n");
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        return reply.code(500).send({ error: e.message });
      }
    }

    const propsSet = new Set(Object.keys(updates));
    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const idx = trimmed.indexOf("=");
        if (idx > -1) {
          const key = trimmed.slice(0, idx).trim();
          if (propsSet.has(key)) {
            newLines.push(`${key}=${updates[key]}`);
            propsSet.delete(key);
            continue;
          }
        }
      }
      newLines.push(line);
    }

    // append remaining
    for (const key of propsSet) {
      newLines.push(`${key}=${updates[key]}`);
    }

    await fs.mkdir(server.path, { recursive: true });
    await fs.writeFile(propsPath, newLines.join("\n"));

    return { success: true };
  });

  // Middleware to get server config
  async function withService(idStr: string, reply: FastifyReply, action: (service: any) => Promise<any>) {
    const id = parseInt(idStr, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });
    
    const service = serverManager.getService({
      id: server.id,
      name: server.name,
      directory: server.path,
      port: server.port,
      memory: server.memory,
      version: server.version,
      motd: server.motd ?? undefined,
      mcIcon: server.mcIcon ?? undefined,
      softwareType: server.softwareType,
      onlineMode: server.onlineMode ?? true
    });
    await service.tryAdopt();
    
    try {
      return await action(service);
    } catch (error) {
      if (error instanceof MinecraftServiceError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  }

  app.get<{ Params: { id: string } }>("/:id/status", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const service = serverManager.getService({
      id: server.id,
      name: server.name,
      directory: server.path,
      port: server.port,
      memory: server.memory,
      version: server.version,
      motd: server.motd ?? undefined,
      mcIcon: server.mcIcon ?? undefined,
      softwareType: server.softwareType,
      onlineMode: server.onlineMode ?? true
    });
    await service.tryAdopt();

    const status = service.getStatus();
    const worldExists = await checkWorldExists(server.path);

    return { ...status, worldExists };
  });

  app.post<{ Params: { id: string } }>("/:id/start", async (request, reply) => {
    return withService(request.params.id, reply, async (service) => service.start());
  });

  app.post<{ Params: { id: string } }>("/:id/stop", async (request, reply) => {
    return withService(request.params.id, reply, async (service) => service.stop());
  });

  app.post<{ Params: { id: string } }>("/:id/restart", async (request, reply) => {
    return withService(request.params.id, reply, async (service) => service.restart());
  });

  app.get<{ Params: { id: string }, Querystring: LogsQuery }>("/:id/logs", async (request, reply) => {
    return withService(request.params.id, reply, async (service) => {
      const sinceId = request.query.sinceId ? Number(request.query.sinceId) : undefined;
      return { logs: service.getLogs(sinceId) };
    });
  });

  app.get<{ Params: { id: string }, Querystring: { page?: string, limit?: string, search?: string | string[] } }>("/:id/logs/history", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const page = Math.max(1, parseInt(request.query.page || "1", 10));
    const limit = Math.max(1, Math.min(500, parseInt(request.query.limit || "100", 10)));
    const skip = (page - 1) * limit;

    const whereClause: any = { serverId: id };
    if (request.query.search) {
      const searches = Array.isArray(request.query.search) ? request.query.search : [request.query.search];
      if (searches.length > 0) {
        whereClause.AND = searches.map(s => ({ message: { contains: s } }));
      }
    }

    const [logs, total] = await Promise.all([
      prisma.serverLog.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.serverLog.count({ where: whereClause })
    ]);

    return { logs, page, limit, total, totalPages: Math.ceil(total / limit) };
  });

  app.post<{ Params: { id: string }, Body: CommandBody }>("/:id/command", async (request, reply) => {
    const command = request.body?.command;
    if (typeof command !== "string") {
      return reply.code(400).send({ error: "COMMAND_REJECTED", message: "String command required" });
    }
    return withService(request.params.id, reply, async (service) => service.sendCommand(command));
  });

  // ── Addons (Mods / Plugins) ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/:id/addons", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const isMod = server.softwareType === "fabric" || server.softwareType === "forge";
    const folderName = isMod ? "mods" : "plugins";
    const folderPath = path.join(server.path, folderName);

    try {
      await fs.mkdir(folderPath, { recursive: true });
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      const items = await Promise.all(
        entries.filter(e => e.isFile() && e.name.endsWith(".jar")).map(async (entry) => {
          const fullPath = path.join(folderPath, entry.name);
          const stat = await fs.stat(fullPath);
          return {
            name: entry.name,
            size: formatBytes(stat.size),
            modified: stat.mtime.toISOString()
          };
        })
      );
      return { folder: folderName, items };
    } catch (e: any) {
      return { folder: folderName, items: [] };
    }
  });

  app.post<{ Params: { id: string } }>("/:id/addons", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const isMod = server.softwareType === "fabric" || server.softwareType === "forge";
    const folderName = isMod ? "mods" : "plugins";
    const folderPath = path.join(server.path, folderName);
    await fs.mkdir(folderPath, { recursive: true });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });

    if (!data.filename.endsWith(".jar")) {
      return reply.code(400).send({ error: "Only .jar files are allowed" });
    }

    const destFile = path.join(folderPath, data.filename);
    const writeStream = createWriteStream(destFile);
    await pipeline(data.file, writeStream);

    return { success: true, message: "Addon subido correctamente" };
  });

  app.delete<{ Params: { id: string, filename: string } }>("/:id/addons/:filename", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const filename = request.params.filename;
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const isMod = server.softwareType === "fabric" || server.softwareType === "forge";
    const folderName = isMod ? "mods" : "plugins";
    const filePath = path.join(server.path, folderName, filename);

    if (filePath.includes("..") || !filePath.startsWith(path.resolve(server.path, folderName))) {
       return reply.code(403).send({ error: "Access denied" });
    }

    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (e) {
      return reply.code(500).send({ error: "Failed to delete file" });
    }
  });

  // ── Addons Search ────────────────────────────────────────────────────────
  app.get<{ Params: { id: string }, Querystring: { q: string, version?: string, loader?: string, limit?: string } }>("/:id/addons/search", async (request, reply) => {
    const { q, version, loader, limit } = request.query;
    if (!q) return reply.code(400).send({ error: "Falta el término de búsqueda 'q'" });
    const limitNum = limit ? parseInt(limit, 10) : 20;
    
    try {
      const results = await addonSearchService.search(q, version, loader, limitNum);
      return { success: true, items: results };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post<{ Params: { id: string }, Body: { source: "modrinth" | "curseforge", projectId: string } }>("/:id/addons/install", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const { source, projectId } = request.body;
    if (!source || !projectId) return reply.code(400).send({ error: "Falta source o projectId" });

    let loader = server.softwareType;
    let searchLoader = loader;
    if (loader === "purpur") searchLoader = "paper"; // Equivalencia

    try {
      const versions = await addonSearchService.getVersions(source, projectId, server.version, searchLoader);
      if (!versions || versions.length === 0) {
        return reply.code(404).send({ error: "No hay versiones compatibles para la versión de este servidor." });
      }

      const bestVersion = versions[0];
      const folderName = (loader === "fabric" || loader === "forge") ? "mods" : "plugins";
      const destFolder = path.join(server.path, folderName);
      await fs.mkdir(destFolder, { recursive: true });
      
      const destPath = path.join(destFolder, bestVersion.filename);
      
      const downloadRes = await fetch(bestVersion.downloadUrl);
      if (!downloadRes.ok) throw new Error("Fallo al descargar de la fuente externa");
      
      const arrayBuffer = await downloadRes.arrayBuffer();
      await fs.writeFile(destPath, Buffer.from(arrayBuffer));

      return { success: true, message: `Instalado ${bestVersion.filename}` };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── File Browser ──────────────────────────────────────────────────────────
  app.get<{ Params: { id: string }, Querystring: FilesQuery }>("/:id/files", async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const serverRoot = server.path;
    const requestedRelPath = request.query.path ?? ".";

    // Seguridad: resolver y asegurar que la ruta queda dentro del directorio del servidor
    const resolvedPath = path.resolve(serverRoot, requestedRelPath);
    if (!resolvedPath.startsWith(path.resolve(serverRoot))) {
      return reply.code(403).send({ error: "Access denied: path traversal detected" });
    }

    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        return reply.code(400).send({ error: "Path is not a directory" });
      }

      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      const items = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(resolvedPath, entry.name);
          const relPath = path.relative(serverRoot, fullPath).replace(/\\/g, "/");
          let size = 0;
          let modified = "";
          try {
            const s = await fs.stat(fullPath);
            size = s.size;
            modified = s.mtime.toISOString();
          } catch { }
          return {
            name: entry.name,
            path: relPath,
            type: entry.isDirectory() ? "dir" : "file",
            size,
            sizeFormatted: entry.isFile() ? formatBytes(size) : null,
            modified,
            extension: entry.isFile() ? path.extname(entry.name).toLowerCase() : null
          };
        })
      );

      // Ordenar: carpetas primero, luego archivos
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const relCurrentPath = path.relative(serverRoot, resolvedPath).replace(/\\/g, "/") || ".";
      const parentPath = resolvedPath === path.resolve(serverRoot)
        ? null
        : path.relative(serverRoot, path.dirname(resolvedPath)).replace(/\\/g, "/") || ".";

      return {
        currentPath: relCurrentPath,
        parentPath,
        serverExists: true,
        items
      };
    } catch (e: any) {
      if (e.code === "ENOENT") {
        // El directorio del servidor aún no existe (nunca se ha iniciado)
        return {
          currentPath: ".",
          parentPath: null,
          serverExists: false,
          items: []
        };
      }
      throw e;
    }
  });
}
