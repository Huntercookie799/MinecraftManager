import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { Jimp } from "jimp";
import PDFDocument from "pdfkit";
import { prisma } from "../../Models/prisma";
import { serverManager } from "../../Services/ServerManager";
import { S3SyncService } from "../../Services/S3SyncService";
import { addonSearchService } from "../../Services/AddonSearchService";
import { getLanIp } from "../../Utils/network";

interface ServerParams {
  serverId: string;
}

interface WorldParams extends ServerParams {
  id: string;
}

interface CreateWorldBody {
  name: string;
  allowMods?: boolean;
  allowPlugins?: boolean;
  modpackId?: string;
  modpackSource?: string;
}

// ─── Helper: estadísticas de contenido de un mundo (mods/plugins/configs) ───

async function countWorldContents(base: string) {
  const countJars = async (folder: string) => {
    try {
      const entries = await fs.readdir(path.join(base, folder));
      return entries.filter(e => e.endsWith(".jar")).length;
    } catch { return 0; }
  };
  const countFilesRecursive = async (folder: string, depth = 0): Promise<number> => {
    if (depth > 4) return 0;
    try {
      const entries = await fs.readdir(path.join(base, folder), { withFileTypes: true });
      let n = 0;
      for (const e of entries) {
        if (e.isDirectory()) n += await countFilesRecursive(path.join(folder, e.name), depth + 1);
        else n++;
      }
      return n;
    } catch { return 0; }
  };
  const countEntries = async (folder: string) => {
    try { return (await fs.readdir(path.join(base, folder))).length; } catch { return 0; }
  };

  const [mods, plugins, configs, defaultconfigs, resourcepacks] = await Promise.all([
    countJars("mods"),
    countJars("plugins"),
    countFilesRecursive("config"),
    countFilesRecursive("defaultconfigs"),
    countEntries("resourcepacks")
  ]);
  return { mods, plugins, configs, defaultconfigs, resourcepacks };
}

async function getFolderSize(dir: string): Promise<number> {
  let totalSize = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        totalSize += await getFolderSize(fullPath);
      } else {
        const stats = await fs.stat(fullPath).catch(() => null);
        if (stats) totalSize += stats.size;
      }
    }
  } catch {
    // Ignorar si no existe
  }
  return totalSize;
}

// ─── Helper: contenido del tutorial/manual de un mundo ───────────────────────

interface TutorialStep {
  title: string;
  text: string;
}

interface TutorialContent {
  world: string;
  server: string;
  version: string;
  hostname: string;
  lanIp: string;
  port: number;
  hasMods: boolean;
  mods: number;
  plugins: number;
  configs: number;
  title: string;
  intro: string;
  steps: TutorialStep[];
}

async function buildTutorialContent(server: any, world: any, stats: any): Promise<TutorialContent> {
  const hasMods = (stats?.mods ?? 0) > 0 || (stats?.plugins ?? 0) > 0;
  const hostname = server.hostname || `${server.name.toLowerCase()}.server01`;
  const version = server.version || "1.21.x";
  const lanIp = getLanIp();

  const steps: TutorialStep[] = [
    {
      title: "1. Descargá e instalá SKLauncher",
      text: "Descargá SKLauncher desde https://skmedix.pl (o sklauncher.com) e instalalo. Es gratuito y no requiere cuenta premium: al estar el servidor en modo offline, podés poner cualquier nombre de usuario al iniciar sesión."
    }
  ];

  if (hasMods) {
    steps.push({
      title: "2. Opción A — Instalá el modpack desde SKLauncher (si está disponible)",
      text: `En SKLauncher abrí el instalador de modpacks y buscá "${world.name}" por su nombre. Si aparece, instalalo seleccionando la versión ${version}. Si no aparece (porque es una colección de mods propia), usá la Opción B.`
    });
    steps.push({
      title: "3. Opción B — Instalá los mods manualmente (colección de mods)",
      text: `1) Descargá el mundo "${world.name}" como .zip desde el panel (botón de descarga). 2) Extraé el zip: la carpeta mods/ tiene ${stats?.mods ?? 0} mod(s) y plugins/ ${stats?.plugins ?? 0} plugin(s). 3) En SKLauncher instalá la versión ${version} con el loader del pack (Fabric, Forge o NeoForge, según corresponda). 4) Abrí la carpeta del juego (.minecraft), entrá a la carpeta mods/ y copiá ahí los .jar. 5) Si querés las configuraciones exactas del pack, copiá también la carpeta config/.`
    });
    steps.push({
      title: "4. Conectate al servidor",
      text: `Abrí Minecraft → Multijugador → Agregar servidor. Nombre: ${server.name}. Dirección: ${hostname} (puerto 443). Si el hostname no resuelve, usá la IP local ${lanIp}:443.`
    });
  } else {
    steps.push({
      title: "2. Elegí la versión en SKLauncher",
      text: `Este mundo es vanilla (sin mods): en SKLauncher elegí la versión ${version} y no hace falta instalar nada más.`
    });
    steps.push({
      title: "3. Conectate al servidor",
      text: `Abrí Minecraft → Multijugador → Agregar servidor. Nombre: ${server.name}. Dirección: ${hostname} (puerto 443). Si el hostname no resuelve, usá la IP local ${lanIp}:443.`
    });
  }

  return {
    world: world.name,
    server: server.name,
    version,
    hostname,
    lanIp,
    port: 443,
    hasMods,
    mods: stats?.mods ?? 0,
    plugins: stats?.plugins ?? 0,
    configs: stats?.configs ?? 0,
    title: `Manual de instalación — Mundo "${world.name}"`,
    intro: hasMods
      ? `Este mundo incluye ${stats?.mods ?? 0} mod(s) y ${stats?.plugins ?? 0} plugin(s) instalados en su carpeta. Seguí estos pasos para jugarlo desde SKLauncher.`
      : `Este mundo es vanilla (sin mods). Solo necesitás SKLauncher y conectarte al servidor.`,
    steps
  };
}

// Ensure extracted ZIPs have a valid 'world' folder structure
export async function sanitizeExtractedWorld(worldPath: string) {
  try {
    const items = await fs.readdir(worldPath);
    if (items.includes("world")) return;

    if (items.includes("level.dat")) {
      const worldDir = path.join(worldPath, "world");
      await fs.mkdir(worldDir);
      const exclusions = ["mods", "plugins", "config", "defaultconfigs", "resourcepacks"];
      for (const item of items) {
        if (!exclusions.includes(item) && item !== "world") {
          await fs.rename(path.join(worldPath, item), path.join(worldDir, item));
        }
      }
      return;
    }

    for (const item of items) {
      const itemPath = path.join(worldPath, item);
      const itemStat = await fs.stat(itemPath);
      if (itemStat.isDirectory()) {
        const innerItems = await fs.readdir(itemPath);
        if (innerItems.includes("level.dat")) {
          await fs.rename(itemPath, path.join(worldPath, "world"));
          return;
        }
      }
    }
  } catch (e) {
    console.error("Error sanitizing world:", e);
  }
}

export async function registerWorldsRoutes(app: FastifyInstance): Promise<void> {
  const thumbnailsDir = path.join(__dirname, "..", "..", "..", "public", "thumbnails");
  await fs.mkdir(thumbnailsDir, { recursive: true }).catch(() => {});

  async function getServerContext(serverIdStr: string, reply: FastifyReply) {
    const serverId = parseInt(serverIdStr, 10);
    if (isNaN(serverId)) {
      reply.code(400).send({ error: "Invalid server ID" });
      return null;
    }
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      reply.code(404).send({ error: "Server not found" });
      return null;
    }
    return server;
  }

  async function getWorldContext(req: { params: WorldParams }, reply: FastifyReply) {
    const server = await getServerContext(req.params.serverId, reply);
    if (!server) return null;
    const worldId = parseInt(req.params.id, 10);
    if (isNaN(worldId)) {
      reply.code(400).send({ error: "Invalid ID" });
      return null;
    }
    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world || world.serverId !== server.id) {
      reply.code(404).send({ error: "Mundo no encontrado" });
      return null;
    }
    return { server, world };
  }

  app.get<{ Params: ServerParams }>("/", async (request, reply) => {
    const serverId = parseInt(request.params.serverId, 10);
    const worlds = await prisma.world.findMany({
      where: { serverId },
      orderBy: { createdAt: "desc" }
    });
    
    // Fetch allowMods/allowPlugins manually since schema is not updated in memory
    const rawWorlds = await prisma.$queryRaw<any[]>`SELECT id, allowMods, allowPlugins FROM world WHERE serverId = ${serverId}`;
    const allowModsMap = new Map(rawWorlds.map(w => [w.id, !!w.allowMods]));
    const allowPluginsMap = new Map(rawWorlds.map(w => [w.id, !!w.allowPlugins]));
    
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const mappedWorlds = await Promise.all(worlds.map(async w => {
      let sizeBytes = 0;
      let compatibilityWarning = null;
      if (server && server.path) {
        const base = w.isActive ? server.path : path.join(server.path, "worlds_backup", w.path);
        const foldersToSum = ["world", "world_nether", "world_the_end", "mods", "plugins", "resourcepacks", "config", "defaultconfigs"];
        for (const folder of foldersToSum) {
          sizeBytes += await getFolderSize(path.join(base, folder));
        }

        try {
          const levelDatPath = path.join(base, "world", "level.dat");
          const buf = await fs.readFile(levelDatPath);
          const nbt = require("prismarine-nbt");
          const { parsed } = await nbt.parse(buf);
          const worldVersion = parsed.value?.Data?.value?.Version?.value?.Name?.value;
          
          if (worldVersion) {
            const serverMajor = server.version?.split('.').slice(0,2).join('.') || "1.21";
            const worldMajor = worldVersion.split('.').slice(0,2).join('.');
            if (worldMajor && worldMajor !== serverMajor) {
              let hasCustomDatapacks = false;
              try {
                const entries = await fs.readdir(path.join(base, "world", "datapacks"));
                hasCustomDatapacks = entries.some(e => e !== "bukkit");
              } catch (e) {}

              if (hasCustomDatapacks) {
                compatibilityWarning = `El mundo es v${worldVersion} con Datapacks, puede ser INCOMPATIBLE con tu servidor (${server.version}).`;
              }
            }
          }
        } catch (e) {
          // file missing or invalid
        }
      }

      return { 
        ...w, 
        allowMods: allowModsMap.has(w.id) ? allowModsMap.get(w.id) : true,
        allowPlugins: allowPluginsMap.has(w.id) ? allowPluginsMap.get(w.id) : true,
        sizeBytes,
        compatibilityWarning
      };
    }));
    return { worlds: mappedWorlds };
  });

  app.post<{ Params: ServerParams, Body: CreateWorldBody }>("/", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const { name } = request.body || {};
    if (!name || typeof name !== "string") return reply.code(400).send({ error: "Invalid name" });
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return reply.code(400).send({ error: "Name can only contain letters, numbers, hyphens and underscores." });

    const existing = await prisma.world.findUnique({ where: { serverId_name: { serverId: server.id, name } } });
    if (existing) return reply.code(409).send({ error: "A world with that name already exists in this server." });

    const totalWorlds = await prisma.world.count({ where: { serverId: server.id } });
    const isActive = totalWorlds === 0;

    const world = await prisma.world.create({
      data: { name, path: name, isActive, serverId: server.id }
    });

    // Si se elige un modpack, el mundo se crea con mods → allowMods forzado a true
    const hasModpack = !!(request.body.modpackId && request.body.modpackSource);
    const allowMods = hasModpack ? true : request.body.allowMods !== false;
    const allowPlugins = request.body.allowPlugins !== false;
    await prisma.$executeRaw`UPDATE world SET allowMods = ${allowMods}, allowPlugins = ${allowPlugins} WHERE id = ${world.id}`;
    
    // Asignar el valor manualmente para la respuesta
    (world as any).allowMods = allowMods;
    (world as any).allowPlugins = allowPlugins;

    // ── Generar los archivos del mundo y subirlos directamente ──
    // Crea la estructura de carpetas (world, world_nether, world_the_end).
    // El servidor completa la generación real del mundo al arrancar sobre ellas.
    try {
      const worldsBackupDir = path.join(server.path, "worlds_backup");
      const bases = isActive ? [server.path] : [path.join(worldsBackupDir, name)];

      for (const base of bases) {
        for (const folder of ["world", "world_nether", "world_the_end", "mods", "plugins"]) {
          await fs.mkdir(path.join(base, folder), { recursive: true });
        }
      }

      // ── Instalar el modpack dentro del mundo (en su carpeta de backup) ──
      let modpackInfo: { name: string; installed: number; failed: number } | null = null;
      if (hasModpack) {
        const targetDir = isActive ? server.path : path.join(worldsBackupDir, name);
        try {
          modpackInfo = await addonSearchService.installModpack(
            request.body.modpackSource as string,
            request.body.modpackId as string,
            server.version ?? undefined,
            targetDir
          );
        } catch (e: any) {
          app.log.error(`Failed to install modpack for world ${name}`, e);
          modpackInfo = { name: String(request.body.modpackId), installed: 0, failed: 0 };
        }
      }

      if (modpackInfo) (world as any).modpack = modpackInfo;

      // Subir el backup del mundo nuevo a S3 de inmediato
      const s3 = new S3SyncService();
      if (s3.isConfigured) {
        const uploadSource = isActive ? server.path : path.join(worldsBackupDir, name);
        await s3.zipAndUploadFolder(
          uploadSource,
          `${server.id}/worlds/${name}.zip`,
          (msg) => app.log.info(msg)
        );
      }
    } catch (e: any) {
      app.log.error("Failed to generate world files or upload to S3", e);
    }

    return { world };
  });

  app.put<{ Params: WorldParams, Body: { name: string } }>("/:id", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    const { name, allowMods, allowPlugins } = request.body as any;
    
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });
    if (!name || !/^[a-zA-Z0-9_ -]+$/.test(name)) return reply.code(400).send({ error: "Invalid new name" });

    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "World not found" });

    const existing = await prisma.world.findUnique({ where: { serverId_name: { serverId: server.id, name } } });
    if (existing && existing.id !== worldId) {
      return reply.code(409).send({ error: "A world with that name already exists in this server." });
    }

    const worldsBackupDir = path.join(server.path, "worlds_backup");

    if (!world.isActive) {
      const oldPath = path.join(worldsBackupDir, world.path);
      const newPathName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const newPath = path.join(worldsBackupDir, newPathName);
      
      try {
        await fs.rename(oldPath, newPath);
        await prisma.world.update({ where: { id: worldId }, data: { name, path: newPathName } });
      } catch (e) {
        await prisma.world.update({ where: { id: worldId }, data: { name } });
      }
    } else {
      await prisma.world.update({ where: { id: worldId }, data: { name } });
    }

    if (allowMods !== undefined) {
      await prisma.$executeRaw`UPDATE world SET allowMods = ${allowMods} WHERE id = ${worldId}`;
    }
    if (allowPlugins !== undefined) {
      await prisma.$executeRaw`UPDATE world SET allowPlugins = ${allowPlugins} WHERE id = ${worldId}`;
    }

    return { success: true };
  });

  app.post<{ Params: ServerParams }>("/upload", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });

    const nameField = data.fields.name;
    let name = (nameField && 'value' in nameField) ? String(nameField.value) : data.filename.replace(".zip", "");
    name = name.replace(/[^a-zA-Z0-9_-]/g, "_"); 

    const existing = await prisma.world.findUnique({ where: { serverId_name: { serverId: server.id, name } } });
    if (existing) name = `${name}_${Date.now()}`;

    const worldsBackupDir = path.join(server.path, "worlds_backup");
    const tempZipPath = path.join(worldsBackupDir, `${name}_temp.zip`);
    await fs.mkdir(worldsBackupDir, { recursive: true });

    await pipeline(data.file, createWriteStream(tempZipPath));

    try {
      const zip = new AdmZip(tempZipPath);
      const worldPath = path.join(worldsBackupDir, name);
      zip.extractAllTo(worldPath, true);
      
      await sanitizeExtractedWorld(worldPath);

      let compatibilityWarning = null;
      try {
        const levelDatPath = path.join(worldPath, "world", "level.dat");
        const buf = await fs.readFile(levelDatPath);
        const nbt = require("prismarine-nbt");
        const { parsed } = await nbt.parse(buf);
        const worldVersion = parsed.value?.Data?.value?.Version?.value?.Name?.value;
        if (worldVersion) {
          const serverMajor = server.version?.split('.').slice(0,2).join('.') || "1.21";
          const worldMajor = worldVersion.split('.').slice(0,2).join('.');
          if (worldMajor && worldMajor !== serverMajor) {
            let hasCustomDatapacks = false;
            try {
              const entries = await fs.readdir(path.join(worldPath, "world", "datapacks"));
              hasCustomDatapacks = entries.some(e => e !== "bukkit");
            } catch (e) {}
            if (hasCustomDatapacks) {
              compatibilityWarning = `El mundo es v${worldVersion} con Datapacks, puede ser INCOMPATIBLE con tu servidor (${server.version}).`;
            }
          }
        }
      } catch (e) {}

      const world = await prisma.world.create({
        data: { name, path: name, isActive: false, serverId: server.id }
      });

      return { success: true, world, compatibilityWarning };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: "Failed to extract ZIP" });
    } finally {
      await fs.rm(tempZipPath, { force: true }).catch(() => {});
    }
  });

  app.post<{ Params: WorldParams }>("/:id/thumbnail", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });

    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "World not found" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });

    const ext = path.extname(data.filename) || ".png";
    const thumbnailName = `world_${worldId}_${Date.now()}${ext}`;
    const dest = path.join(thumbnailsDir, thumbnailName);

    await pipeline(data.file, createWriteStream(dest));

    await prisma.world.update({ where: { id: worldId }, data: { thumbnail: `/thumbnails/${thumbnailName}` } });

    if (world.thumbnail) {
      const oldThumb = path.join(__dirname, "..", "..", "..", "public", world.thumbnail);
      await fs.rm(oldThumb, { force: true }).catch(() => {});
    }

    try {
      const image = await Jimp.read(dest);
      image.resize({ w: 64, h: 64 });
      if (world.isActive) {
        await image.write(path.join(server.path, "server-icon.png") as any);
      }
    } catch (e) {
      app.log.error("Failed to process thumbnail for server-icon.png", e as any);
    }

    return { success: true, thumbnail: `/thumbnails/${thumbnailName}` };
  });

  app.get<{ Params: WorldParams }>("/:id/stats", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });

    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "Mundo no encontrado" });

    const base = world.isActive ? server.path : path.join(server.path, "worlds_backup", world.path);
    const stats = await countWorldContents(base);
    return { world: world.name, ...stats };
  });

  // ── Tutorial / Manual del mundo ────────────────────────────────────────────
  // GET /:id/tutorial → contenido del tutorial (JSON)
  app.get<{ Params: WorldParams }>("/:id/tutorial", async (request, reply) => {
    const ctx = await getWorldContext(request, reply);
    if (!ctx) return;
    const base = ctx.world.isActive ? ctx.server.path : path.join(ctx.server.path, "worlds_backup", ctx.world.path);
    const stats = await countWorldContents(base);
    return buildTutorialContent(ctx.server, ctx.world, stats);
  });

  // GET /:id/tutorial.pdf → manual en PDF (SKLauncher)
  app.get<{ Params: WorldParams }>("/:id/tutorial.pdf", async (request, reply) => {
    const ctx = await getWorldContext(request, reply);
    if (!ctx) return;
    const base = ctx.world.isActive ? ctx.server.path : path.join(ctx.server.path, "worlds_backup", ctx.world.path);
    const stats = await countWorldContents(base);
    const content = await buildTutorialContent(ctx.server, ctx.world, stats);

    const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 52, right: 52 }, info: { Title: content.title } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));

    // Encabezado
    doc.fontSize(20).fillColor("#1a1a1a").text(content.title, { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#666666").text(
      `Servidor: ${content.server}  ·  Versión: ${content.version}  ·  Hostname: ${content.hostname}:${content.port}`,
      { align: "center" }
    );
    doc.moveDown(1);

    // Intro
    doc.fontSize(11).fillColor("#333333").text(content.intro);
    doc.moveDown(1);

    // Pasos
    for (const step of content.steps) {
      doc.fillColor("#1a6fb5").fontSize(13).text(step.title);
      doc.fillColor("#333333").fontSize(10.5).text(step.text, { lineGap: 3 });
      doc.moveDown(0.8);
    }

    doc.moveDown(1.5);
    doc.fontSize(9).fillColor("#999999").text("Manual generado por Minecraft Manager.", { align: "center" });

    doc.end();
    await new Promise<void>((resolve) => doc.on("end", () => resolve()));
    const buffer = Buffer.concat(chunks);
    reply.header("Content-Disposition", `attachment; filename="manual-${content.world}.pdf"`);
    reply.type("application/pdf");
    return reply.send(buffer);
  });

  app.get<{ Params: WorldParams }>("/:id/export", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });

    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "World not found" });

    const service = serverManager.getServiceById(server.id);
    if (world.isActive && service && service.getStatus().status !== "OFFLINE") {
      return reply.code(409).send({ error: "Detén el servidor antes de descargar el mundo activo." });
    }

    const zip = new AdmZip();
    // Incluye las carpetas del modpack (mods, resourcepacks, configs)
    const foldersToZip = ["world", "world_nether", "world_the_end", "mods", "plugins", "resourcepacks", "config", "defaultconfigs"];
    const worldsBackupDir = path.join(server.path, "worlds_backup");

    try {
      if (world.isActive) {
        for (const folder of foldersToZip) {
          const folderPath = path.join(server.path, folder);
          try {
            await fs.access(folderPath);
            zip.addLocalFolder(folderPath, folder);
          } catch {}
        }
      } else {
        const backupPath = path.join(worldsBackupDir, world.path);
        for (const folder of foldersToZip) {
          const folderPath = path.join(backupPath, folder);
          try {
            await fs.access(folderPath);
            zip.addLocalFolder(folderPath, folder);
          } catch {}
        }
      }

      const buffer = zip.toBuffer();
      reply.header('Content-Disposition', `attachment; filename="${world.name}.zip"`);
      reply.type('application/zip');
      return reply.send(buffer);
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: "Failed to create ZIP file" });
    }
  });

  app.get<{ Params: WorldParams }>("/:id/export-modpack", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });

    const world = await prisma.world.findUnique({ where: { id: worldId } });
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "World not found" });

    const zip = new AdmZip();
    // Only include mod-related folders
    const foldersToZip = ["mods", "config", "defaultconfigs", "resourcepacks"];
    const worldsBackupDir = path.join(server.path, "worlds_backup");

    try {
      if (world.isActive) {
        for (const folder of foldersToZip) {
          const folderPath = path.join(server.path, folder);
          try {
            await fs.access(folderPath);
            zip.addLocalFolder(folderPath, folder);
          } catch {}
        }
      } else {
        const backupPath = path.join(worldsBackupDir, world.path);
        for (const folder of foldersToZip) {
          const folderPath = path.join(backupPath, folder);
          try {
            await fs.access(folderPath);
            zip.addLocalFolder(folderPath, folder);
          } catch {}
        }
      }

      const buffer = zip.toBuffer();
      reply.header('Content-Disposition', `attachment; filename="Modpack_${world.name}.zip"`);
      reply.type('application/zip');
      return reply.send(buffer);
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: "Failed to create ZIP file" });
    }
  });

  app.post<{ Params: WorldParams }>("/:id/load", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    if (isNaN(worldId)) return reply.code(400).send({ error: "Invalid ID" });

    const worldToLoad = await prisma.world.findUnique({ where: { id: worldId } });
    if (!worldToLoad || worldToLoad.serverId !== server.id) return reply.code(404).send({ error: "Mundo no encontrado" });
    if (worldToLoad.isActive) return reply.code(400).send({ error: "Ese mundo ya está activo" });

    const service = serverManager.getServiceById(server.id);
    if (service && service.getStatus().status !== "OFFLINE") {
      return reply.code(409).send({ error: "Detén el servidor de Minecraft antes de cambiar el mundo activo." });
    }

    const worldsBackupDir = path.join(server.path, "worlds_backup");
    await fs.mkdir(worldsBackupDir, { recursive: true });

    const activeWorld = await prisma.world.findFirst({ where: { serverId: server.id, isActive: true } });
    // Carpetas que viajan con el mundo (modpacks incluyen mods, resourcepacks y configs)
    const foldersToSwap = ["world", "world_nether", "world_the_end", "mods", "plugins", "resourcepacks"];
    // Carpetas de config que se intercambian a nivel de ARCHIVO para no tocar
    // los configs globales del servidor (paper-global.yml, etc.)
    const configFolders = ["config", "defaultconfigs"];
    // Archivos de Paper/Purpur que pertenecen al SERVIDOR, no al mundo
    const serverConfigFiles = ["paper-global.yml", "paper-world-defaults.yml", "paper-world-defaults-world.yml", "paper-world-defaults-nether.yml", "paper-world-defaults-the_end.yml"];

    async function moveEntriesExcept(srcDir: string, destDir: string) {
      await fs.mkdir(destDir, { recursive: true });
      const entries = await fs.readdir(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        if (serverConfigFiles.includes(entry.name)) continue;
        await fs.rm(path.join(destDir, entry.name), { recursive: true, force: true }).catch(() => {});
        await fs.rename(path.join(srcDir, entry.name), path.join(destDir, entry.name));
      }
    }

    if (activeWorld) {
      const backupPath = path.join(worldsBackupDir, activeWorld.path);
      await fs.mkdir(backupPath, { recursive: true });

      for (const folder of foldersToSwap) {
        const src = path.join(server.path, folder);
        const dest = path.join(backupPath, folder);
        try {
          await fs.access(src);
          await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
          await fs.rename(src, dest);
        } catch {}
      }
      for (const folder of configFolders) {
        try {
          await fs.access(path.join(server.path, folder));
          await moveEntriesExcept(path.join(server.path, folder), path.join(backupPath, folder));
        } catch {}
      }
      await prisma.world.update({ where: { id: activeWorld.id }, data: { isActive: false } });
    }

    const loadPath = path.join(worldsBackupDir, worldToLoad.path);
    for (const folder of foldersToSwap) {
      const src = path.join(loadPath, folder);
      const dest = path.join(server.path, folder);
      try {
        await fs.access(src);
        await fs.rename(src, dest);
      } catch {}
    }
    for (const folder of configFolders) {
      try {
        await fs.access(path.join(loadPath, folder));
        await moveEntriesExcept(path.join(loadPath, folder), path.join(server.path, folder));
      } catch {}
    }

    await prisma.world.update({ where: { id: worldId }, data: { isActive: true } });

    if (worldToLoad.thumbnail) {
      const thumbPath = path.join(__dirname, "..", "..", "..", "public", worldToLoad.thumbnail);
      try {
        const image = await Jimp.read(thumbPath);
        image.resize({ w: 64, h: 64 });
        await image.write(path.join(server.path, "server-icon.png") as any);
      } catch (e) {
        app.log.error("Failed to process thumbnail on load", e as any);
      }
    } else {
      await fs.rm(path.join(server.path, "server-icon.png"), { force: true }).catch(() => {});
    }

    return { success: true, message: `World ${worldToLoad.name} is now active.` };
  });

  app.delete<{ Params: WorldParams }>("/:id", async (request, reply) => {
    const server = await getServerContext(request.params.serverId, reply);
    if (!server) return;

    const worldId = parseInt(request.params.id, 10);
    const world = await prisma.world.findUnique({ where: { id: worldId } });
    
    if (!world || world.serverId !== server.id) return reply.code(404).send({ error: "World not found" });
    if (world.isActive) return reply.code(400).send({ error: "Cannot delete the active world. Switch to another world first." });

    const worldsBackupDir = path.join(server.path, "worlds_backup");
    const worldPath = path.join(worldsBackupDir, world.path);
    
    try {
      await fs.rm(worldPath, { recursive: true, force: true });
    } catch {}

    if (world.thumbnail) {
      const thumbPath = path.join(__dirname, "..", "..", "..", "public", world.thumbnail);
      await fs.rm(thumbPath, { force: true }).catch(() => {});
    }

    await prisma.world.delete({ where: { id: worldId } });

    return { success: true };
  });
}
