import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";

const execFileAsync = promisify(execFile);
import { prisma } from "../Models/prisma";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import type { Dimension, LogEntry, LogStream, PlayerInfo, ServerState, ServerStatus } from "../Types/server";
import { RingBuffer } from "../Utils/ringBuffer";
import { applyServerPort } from "../Utils/serverProperties";

interface PlayerSession {
  join?: Date;
  total: number;
  dimension: Dimension;
  x: number | null;
  y: number | null;
  z: number | null;
}

interface PlayerState {
  count: number;
  max: number;
  names: string[];
}

import { jarManager } from "./JarManager";
import { S3SyncService } from "./S3SyncService";
import { autoRepairService } from "./AutoRepairService";
import { Rcon } from "rcon-client";
import crypto from "crypto";
import fsSync from "fs";

export interface MinecraftServerConfig {
  id: number;
  name: string;
  directory: string;
  port: number;
  memory: string;
  version?: string;
  motd?: string;
  mcIcon?: string;
  softwareType?: string;
  onlineMode?: boolean;
  syncWithS3?: boolean;
}

type ServiceErrorCode =
  | "COMMAND_REJECTED"
  | "EULA_NOT_ACCEPTED"
  | "MINECRAFT_NOT_RUNNING"
  | "PAPER_JAR_MISSING"
  | "JAR_DOWNLOAD_FAILED"
  | "SERVER_NOT_ONLINE"
  | "PROCESS_ORPHANED";

export class MinecraftServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: ServiceErrorCode
  ) {
    super(message);
  }
}

export class MinecraftService extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private state: ServerState = "OFFLINE";
  private startedAt?: Date;
  private lastError?: string;
  private readonly logs = new RingBuffer<LogEntry>(env.logBufferSize);
  private nextLogId = 1;
  private readonly remainders: Record<"stdout" | "stderr", string> = {
    stdout: "",
    stderr: ""
  };
  private players: PlayerState = {
    count: 0,
    max: 20,
    names: []
  };
  private world = "world";
  private syncedSkins: Set<string> = new Set();
  private worldTime: number | null = null;
  private pollingTimer?: NodeJS.Timeout;

  // Track per-player join times, total playtime (seconds), dimension and coords
  private playerSessions: Record<string, PlayerSession> = {};
  
  // Custom death messages cache
  private deathMessages: Array<{dimension: string, message: string, playerName?: string | null}> = [];

  // Used to correlate pending data queries
  private pendingDataQuery: string | null = null;

  private s3Sync: S3SyncService;
  
  // Database logs batching
  private pendingDbLogs: { level: string, message: string, createdAt: Date }[] = [];
  private flushLogsTimer?: NodeJS.Timeout;
  private jarPath?: string;

  // Orphaned process adoption (the panel restarted while a server kept running)
  private adopted = false;
  private adoptedPid?: number;
  private tailTimer?: NodeJS.Timeout;
  private s3BackupTimer?: NodeJS.Timeout;
  private tailOffset = 0;
  private adoptionChecked = false;
  private refreshTried = new Set<string>();
  private autoRepairAttempts = 0;

  constructor(public readonly config: MinecraftServerConfig) {
    super();
    this.s3Sync = new S3SyncService();
  }

  get version(): string {
    return this.config.version || "1.21.8";
  }

  get isAdopted(): boolean {
    return this.adopted;
  }

  public async loadDeathMessages() {
    try {
      const messages = await prisma.$queryRaw<any[]>`SELECT * FROM serverdeathmessage WHERE serverId = ${this.config.id}`;
      this.deathMessages = messages || [];
    } catch (e: any) {
      console.error("[MinecraftService] Error loading death messages:", e);
    }
  }

  async start(): Promise<ServerStatus> {
    this.loadDeathMessages();
    if (this.child && !this.child.killed) {
      return this.getStatus();
    }
    // An adopted orphan is still running — nothing to start.
    if (this.adopted && this.isPidAlive(this.adoptedPid)) {
      return this.getStatus();
    }
    if (this.adopted) {
      this.adopted = false;
      this.stopFileTail();
      this.stopS3BackupTimer();
    }

    this.state = "STARTING";
    this.startedAt = new Date();
    this.lastError = undefined;
    this.autoRepairAttempts = 0;

    try {
      await this.ensureRuntimeIsReady();
    } catch (e: any) {
      this.state = "ERROR";
      this.lastError = e.message;
      this.addLog("system", `Setup error: ${e.message}`);
      throw e;
    }

    await this.ensureServerProperties();
    await this.ensureServerIcon();
    this.readServerProperties();

    // Puertos privilegiados (<1024, p.ej. 80/443): en Linux requieren root o CAP_NET_BIND_SERVICE
    if (this.config.port < 1024 && process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0) {
      this.addLog("system", `Advertencia: el puerto ${this.config.port} es privilegiado (<1024). En Linux necesitás ejecutar el panel como root o dar CAP_NET_BIND_SERVICE a la JVM para bindearlo.`);
    }

    // Auto-validate port and kill any zombie Java process using it
    const conflictingPid = await this.findProcessByPort(this.config.port);
    if (conflictingPid) {
      this.addLog("system", `El puerto ${this.config.port} está en uso por el proceso Java (PID ${conflictingPid}). Intentando detenerlo para liberar el puerto...`);
      try {
        await this.killPid(conflictingPid);
        this.addLog("system", `Proceso ${conflictingPid} terminado exitosamente.`);
        // Wait a brief moment for the OS to fully release the port binding
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e: any) {
        this.addLog("system", `Advertencia: No se pudo terminar el proceso ${conflictingPid}: ${e.message}`);
      }
    }

    this.addLog("system", `Starting Minecraft from ${this.config.directory}`);

    let exeName = env.javaBin;
    let args: string[] = [];

    if (this.config.softwareType === 'bedrock') {
      exeName = this.jarPath || (process.platform === "win32" ? "bedrock_server.exe" : "./bedrock_server");
      args = []; // Bedrock doesn't use -Xms -Xmx etc.
    } else {
      // Auto-detect Java requirement based on Minecraft version
      if (this.version) {
        const v = this.version.split('.').map(Number);
        const is1_17_or_above = v[0] > 1 || (v[0] === 1 && v[1] >= 17);
        const is1_20_5_or_above = v[0] > 1 || (v[0] === 1 && (v[1] > 20 || (v[1] === 20 && v[2] >= 5)));

        if (is1_20_5_or_above) {
          // Needs Java 21 (fallback to default javaBin if no specific bin for 21 exists)
        } else if (is1_17_or_above) {
          // Needs Java 17
          if (env.javaBin17) {
            exeName = env.javaBin17;
            this.addLog("system", `Auto-detected Java 17 requirement. Using JAVA_BIN_17.`);
          }
        } else {
          // Needs Java 8 or 11
          if (env.javaBin8) {
            exeName = env.javaBin8;
            this.addLog("system", `Auto-detected Java 8 requirement. Using JAVA_BIN_8.`);
          }
        }
      }

      if (this.jarPath && this.jarPath.endsWith("win_args.txt")) {
        // Forge >= 1.17 uses args file instead of -jar
        args = ["-Xms" + this.config.memory, "-Xmx" + this.config.memory, `@${this.jarPath}`, "nogui"];
      } else {
        args = ["-Xms" + this.config.memory, "-Xmx" + this.config.memory, "-jar", this.jarPath ?? env.paperJar, "nogui"];
      }
    }

    const spawnEnv = { ...process.env };
    if (this.config.softwareType === 'bedrock' && process.platform !== "win32") {
      spawnEnv.LD_LIBRARY_PATH = this.config.directory;
    }

    const child = spawn(exeName, args, {
      cwd: this.config.directory,
      env: spawnEnv,
      stdio: "pipe",
      windowsHide: true
    });

    this.child = child;
    void fs.writeFile(this.pidPath, String(child.pid), "utf8").catch(() => {});

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => this.consumeStream("stdout", data));
    child.stderr.on("data", (data: string) => this.consumeStream("stderr", data));

    child.once("error", (error) => {
      this.lastError = error.message;
      this.state = "ERROR";
      this.addLog("system", `Minecraft process error: ${error.message}`);
      this.stopPolling();
    });

    child.once("exit", async (code, signal) => {
      this.flushRemainder("stdout");
      this.flushRemainder("stderr");

      const expectedStop = this.state === "STOPPING" || code === 0;
      this.addLog("system", `Minecraft exited with code ${code ?? "null"} and signal ${signal ?? "null"}`);

      this.child = undefined;
      this.startedAt = undefined;
      this.players = { ...this.players, count: 0, names: [] };
      this.worldTime = null;
      // Guardar si estábamos parando intencionalmente ANTES de cambiar this.state
      const wasStopping = this.state === "STOPPING";

      this.state = expectedStop ? "OFFLINE" : "ERROR";
      this.stopPolling();
      this.adopted = false;
      this.stopFileTail();
      void fs.rm(this.pidPath, { force: true }).catch(() => {});

      if (!expectedStop) {
        this.lastError = `Minecraft exited unexpectedly with code ${code ?? "null"}.`;
      }
      
      this.stopS3BackupTimer();

      // Auto-reparación de mods
      let willRestart = false;
      if (!wasStopping && this.autoRepairAttempts < 3) {
        this.addLog("system", "[Auto-Repair] Verificando dependencias faltantes...");
        const consoleOutput = this.logs.toArray().slice(-1000).map((l: any) => l.message).join('\n');
        const repaired = await autoRepairService.analyzeAndRepair(this.config, (msg) => this.addLog("system", msg), consoleOutput);
        if (repaired) {
          willRestart = true;
          this.autoRepairAttempts++;
          this.addLog("system", `[Auto-Repair] Intento ${this.autoRepairAttempts}/3: Dependencias instaladas, reiniciando servidor...`);
          // Esperamos un segundo y llamamos a start() de nuevo
          setTimeout(() => {
            this.start().catch((err) => this.addLog("system", `[Auto-Repair] Error reiniciando: ${err.message}`));
          }, 1000);
        }
      }

      // S3: Crear un backup tras apagarse (esperado o inesperado) solo si no vamos a reiniciar automáticamente
      if (!willRestart && this.config.syncWithS3 !== false) {
        try {
          await this.s3Sync.zipAndUpload(this.config.directory, this.config.id, (msg) => this.addLog("system", msg));
        } catch (e: any) {
          this.addLog("system", `Failed to backup to S3: ${e.message}`);
        }
      }
    });

    return this.getStatus();
  }

  async stop(): Promise<ServerStatus> {
    if (this.adopted) {
      if (this.isPidAlive(this.adoptedPid)) {
        this.addLog("system", `Deteniendo proceso huérfano (PID ${this.adoptedPid}) — sin consola, se fuerza el cierre.`);
        await this.killPid(this.adoptedPid!);
      }
      this.adopted = false;
      this.stopFileTail();
      this.stopS3BackupTimer();
      this.startedAt = undefined;
      this.state = "OFFLINE";
      await fs.rm(this.pidPath, { force: true }).catch(() => {});
      if (this.config.syncWithS3 !== false) {
        try {
          await this.s3Sync.zipAndUpload(this.config.directory, this.config.id, (msg) => this.addLog("system", msg));
        } catch (e: any) {
          this.addLog("system", `Failed to backup to S3: ${e.message}`);
        }
      }
      return this.getStatus();
    }

    if (!this.child || this.child.killed) {
      this.state = "OFFLINE";
      return this.getStatus();
    }

    if (this.state === "STOPPING") {
      return this.getStatus();
    }

    this.state = "STOPPING";
    this.stopPolling();
    this.addLog("system", "Stopping Minecraft with save-all and stop.");
    this.writeRawCommand("save-all");
    this.writeRawCommand("stop");

    await this.waitForExit(env.stopTimeoutMs);
    return this.getStatus();
  }

  async restart(): Promise<ServerStatus> {
    await this.stop();
    return this.start();
  }
  sendCommand(rawCommand: string): { accepted: true; command: string } {
    if (this.state !== "ONLINE" && this.state !== "STARTING") {
      throw new MinecraftServiceError(
        `Cannot send command, server is in state ${this.state}`,
        400,
        "SERVER_NOT_ONLINE"
      );
    }
    
    // Check if we are adopted and don't have RCON enabled (very old orphaned processes)
    if (this.adopted) {
      const propPath = path.join(this.config.directory, "server.properties");
      if (fsSync.existsSync(propPath)) {
        const content = fsSync.readFileSync(propPath, "utf8").toString();
        if (!content.includes("enable-rcon=true")) {
          throw new MinecraftServiceError(
            "Este servidor es un proceso huérfano (sobrevivió a un reinicio del panel). Reinícialo para recuperar la consola.",
            400,
            "PROCESS_ORPHANED"
          );
        }
      }
    }

    const command = this.normalizeCommand(rawCommand);
    this.writeRawCommand(command);
    this.addLog("system", `> ${command}`);

    return { accepted: true, command };
  }

  getStatus(): ServerStatus {
    const uptime = this.startedAt ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000) : 0;
    const now = new Date();

    // Estado honesto: si el proceso adoptado ya no existe, no es ONLINE.
    const liveState: ServerState = this.adopted && !this.isPidAlive(this.adoptedPid) ? "OFFLINE" : this.state;

    const playersInfo: PlayerInfo[] = this.players.names.map((name) => {
      const session = this.playerSessions[name] ?? { total: 0, dimension: "unknown" as Dimension, x: null, y: null, z: null };
      const current = session.join ? (now.getTime() - session.join.getTime()) / 1000 : 0;
      return {
        name,
        online: !!session.join,
        playtimeSeconds: Math.floor(session.total + current),
        dimension: session.dimension ?? "unknown",
        x: session.x ?? null,
        y: session.y ?? null,
        z: session.z ?? null
      };
    });

    return {
      status: liveState,
      players: liveState === "OFFLINE" ? 0 : this.players.count,
      maxPlayers: this.players.max,
      playerNames: this.players.names,
      world: this.world,
      uptime,
      pid: this.child?.pid ?? this.adoptedPid,
      startedAt: this.startedAt?.toISOString(),
      lastError: this.lastError,
      version: `Purpur ${this.version}`,
      ip: process.env.RENDER_EXTERNAL_HOSTNAME || process.env.PUBLIC_IP || "localhost",
      memory: this.config.memory,
      port: this.config.port,
      worldTime: this.worldTime,
      playersInfo
    };
  }

  getLogs(sinceId?: number): LogEntry[] {
    const logs = this.logs.toArray();
    if (!sinceId) return logs;
    return logs.filter((entry) => entry.id > sinceId);
  }

  async dispose(): Promise<void> {
    if (this.adopted) {
      if (this.isPidAlive(this.adoptedPid)) await this.killPid(this.adoptedPid!);
      this.adopted = false;
      this.stopFileTail();
      this.stopS3BackupTimer();
      await fs.rm(this.pidPath, { force: true }).catch(() => {});
      return;
    }
    if (!this.child || this.child.killed) return;
    await this.stop();
  }

  // ─── Private: Polling & Logs ────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollingTimer) return;
    // Run immediately, then every 5s
    this.runPollingCycle();
    this.pollingTimer = setInterval(() => this.runPollingCycle(), 5_000);
    
    // Setup log flushing every 3 seconds
    if (!this.flushLogsTimer) {
      this.flushLogsTimer = setInterval(() => this.flushLogsToDb(), 3000);
    }
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    
    if (this.flushLogsTimer) {
      clearInterval(this.flushLogsTimer);
      this.flushLogsTimer = undefined;
      this.flushLogsToDb(); // Final flush on stop
    }
  }

  private async flushLogsToDb(): Promise<void> {
    if (this.pendingDbLogs.length === 0) return;
    
    // Copy and clear the batch
    const batch = [...this.pendingDbLogs];
    this.pendingDbLogs = [];
    
    try {
      await prisma.serverLog.createMany({
        data: batch.map(log => ({
          serverId: this.config.id,
          level: log.level,
          message: log.message,
          createdAt: log.createdAt
        }))
      });
    } catch (e: any) {
      console.error(`[MinecraftService:${this.config.id}] Failed to flush logs to DB:`, e.message);
      // Re-insert failed logs at the beginning of the queue (limited to avoid infinite growth)
      if (this.pendingDbLogs.length < 1000) {
        this.pendingDbLogs.unshift(...batch);
      }
    }
  }

  private runPollingCycle(): void {
    if (this.state !== "ONLINE" || !this.child || this.child.killed) return;

    // Refresh the online player list every cycle. This keeps the list accurate
    // even for players that were already online before the manager (re)started.
    this.writeRawCommand("list");

    // Query world time
    this.writeRawCommand("time query daytime");

    const now = new Date();
    // Query each online player's dimension and position, and periodically save playtime
    for (const name of this.players.names) {
      this.writeRawCommand(`data get entity ${name} Pos`);
      this.writeRawCommand(`data get entity ${name} Dimension`);

      const session = this.playerSessions[name];
      if (session?.join) {
        const diff = (now.getTime() - session.join.getTime()) / 1000;
        // Save playtime to DB roughly every 60 seconds
        if (diff >= 60) {
          session.total += diff;
          session.join = now;
          this.savePlayerPlaytime(name, Math.floor(session.total));
        }
      }
    }
  }

  // ─── Private: Setup ──────────────────────────────────────────────────────────

  private async ensureRuntimeIsReady(): Promise<void> {
    await fs.mkdir(this.config.directory, { recursive: true });
    await this.ensureServerJar();
    await this.ensureEulaAccepted();
  }

  private async ensureServerJar(): Promise<void> {
    try {
      this.jarPath = await jarManager.resolveJarPath(
        this.config.softwareType || "purpur", 
        this.version, 
        this.config.directory,
        (msg: string) => this.addLog("system", msg)
      );
    } catch (e: any) {
      throw new MinecraftServiceError(
        `Failed to obtain Server jar for version ${this.version}: ${e.message}`,
        500,
        "JAR_DOWNLOAD_FAILED"
      );
    }
  }

  private async ensureEulaAccepted(): Promise<void> {
    const eulaPath = path.join(this.config.directory, "eula.txt");
    await fs.writeFile(eulaPath, "eula=true\n", "utf8");
  }

  private async ensureServerProperties(): Promise<void> {
    const propPath = path.join(this.config.directory, "server.properties");
    let content: string;
    try {
      content = await fs.readFile(propPath, "utf8");
    } catch {
      content = "";
    }

    const original = content;

    // Puerto asignado al servidor (ver applyServerPort: la regex está anclada
    // al inicio de línea para no matchear dentro de management-server-port).
    content = applyServerPort(content, this.config.port);

    // MOTD personalizado (colores § y \n para salto de línea). Los saltos de
    // línea reales se convierten a \n literal para que java.util.Properties los
    // interprete como nueva línea dentro del valor.
    if (this.config.motd) {
      const motd = this.config.motd.replace(/\r?\n/g, "\\n");
      if (content.includes("motd=")) {
        content = content.replace(/^motd=.*$/m, () => `motd=${motd}`);
      } else {
        content += `\nmotd=${motd}\n`;
      }
    }

    // online-mode gestionado: se aplica SIEMPRE (después del restore de S3,
    // que trae el server.properties del backup y pisaría el valor elegido).
    // true = valida contra Mojang, false = LAN/offline (sin sesión de pago).
    const onlineMode = this.config.onlineMode ?? true;
    const omLine = `online-mode=${onlineMode}`;
    if (/^online-mode=.*$/m.test(content)) {
      content = content.replace(/^online-mode=.*$/m, () => omLine);
    } else {
      content += `\n${omLine}\n`;
    }

    // connection-throttle=0: obligatorio cuando los jugadores entran por el
    // MinecraftProxyRouter (80/443). El proxy reenvía TODAS las conexiones desde
    // 127.0.0.1, y el throttle por defecto (4000ms por IP) considera al proxy como
    // "un solo jugador": la 2ª conexión en 4s (otro jugador o un retry del cliente)
    // se mantiene abierta sin respuesta hasta el timeout del cliente. Con 0 queda
    // desactivado, como recomienda BungeeCord para servidores tras un proxy.
    const throttleLine = `connection-throttle=0`;
    if (/^connection-throttle=.*$/m.test(content)) {
      content = content.replace(/^connection-throttle=.*$/m, () => throttleLine);
    } else {
      content += `\n${throttleLine}\n`;
    }

    // Force enable RCON for orphaned processes recovery
    const rconPort = this.config.port + 10000;
    const rconPassword = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
    
    const rconSettings = {
      "enable-rcon": "true",
      "rcon.port": rconPort.toString(),
      "rcon.password": rconPassword
    };

    for (const [key, val] of Object.entries(rconSettings)) {
      const line = `${key}=${val}`;
      if (new RegExp(`^${key}=.*$`, "m").test(content)) {
        content = content.replace(new RegExp(`^${key}=.*$`, "m"), () => line);
      } else {
        content += `\n${line}\n`;
      }
    }

    if (content !== original) {
      await fs.writeFile(propPath, content, "utf8");
    }
  }

  /** Copia el icono personalizado del servidor (server-icon.png 64x64) al
   *  directorio del servidor, para que aparezca en la lista de servidores de
   *  Minecraft. Se ejecuta DESPUÉS del restore de S3 (que podría traer un icono
   *  viejo en el template/backup). */
  private async ensureServerIcon(): Promise<void> {
    if (!this.config.mcIcon) return;
    const src = path.join(process.cwd(), "public", this.config.mcIcon);
    const dest = path.join(this.config.directory, "server-icon.png");
    try {
      await fs.copyFile(src, dest);
    } catch (e: any) {
      this.addLog("system", `No se pudo copiar el icono del servidor: ${e.message}`);
    }
  }

  private readServerProperties(): void {
    void fs.readFile(path.join(this.config.directory, "server.properties"), "utf8")
      .then((content) => {
        const properties = new Map(
          content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"))
            .map((line) => {
              const separator = line.indexOf("=");
              return [line.slice(0, separator), line.slice(separator + 1)] as const;
            })
        );
        this.world = properties.get("level-name") || this.world;
        const maxPlayers = Number(properties.get("max-players"));
        if (Number.isFinite(maxPlayers)) {
          this.players = { ...this.players, max: maxPlayers };
        }
      })
      .catch(() => {
        this.addLog("system", "server.properties was not found; Paper will create it on first start.");
      });
  }

  private normalizeCommand(rawCommand: string): string {
    const command = rawCommand.trim().replace(/^\//, "");
    if (!command) throw new MinecraftServiceError("Command cannot be empty.", 400, "COMMAND_REJECTED");
    if (/[\r\n]/.test(command)) throw new MinecraftServiceError("Command must be a single line.", 400, "COMMAND_REJECTED");
    if (command.length > env.commandMaxLength) {
      throw new MinecraftServiceError(`Command is too long.`, 400, "COMMAND_REJECTED");
    }
    return command;
  }

  private writeRawCommand(command: string): void {
    if (this.child && !this.child.killed && this.child.stdin && this.child.stdin.writable) {
      this.child.stdin.write(`${command}\n`);
    } else if (this.adopted) {
      this.sendRconCommand(command).then(response => {
        if (response && response.trim()) {
          // Procesar la respuesta del RCON como si fuera un log para mantener sincronizado el estado
          this.parseLineForState(response);
        }
      }).catch((e: any) => {
        this.addLog("system", `[RCON Fallback] Error sending command to orphaned process: ${e.message}`);
      });
    }
  }

  private async sendRconCommand(command: string): Promise<string> {
    try {
      const propPath = path.join(this.config.directory, "server.properties");
      const content = await fs.readFile(propPath, "utf8");
      
      const portMatch = content.match(/^rcon\.port=(\d+)$/m);
      const passMatch = content.match(/^rcon\.password=(.+)$/m);
      
      if (!portMatch || !passMatch) {
        throw new Error("RCON not fully configured in server.properties");
      }
      
      const rconPort = parseInt(portMatch[1], 10);
      const rconPassword = passMatch[1].trim();

      const rcon = await Rcon.connect({
        host: "127.0.0.1",
        port: rconPort,
        password: rconPassword,
        timeout: 3000
      });

      const response = await rcon.send(command);
      rcon.end();
      return response;
    } catch (err: any) {
      throw new Error(`RCON error: ${err.message}`);
    }
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    const child = this.child;
    if (!child) return Promise.resolve();
    return new Promise((resolve) => {
      let forceTimer: NodeJS.Timeout | undefined;
      const timeout = setTimeout(() => {
        this.addLog("system", `Minecraft did not stop within ${timeoutMs}ms; killing process.`);
        child.kill("SIGTERM");
        forceTimer = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5_000);
      }, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timeout);
        if (forceTimer) clearTimeout(forceTimer);
        resolve();
      });
    });
  }

  // ─── Private: Log Parsing ────────────────────────────────────────────────────

  private consumeStream(stream: "stdout" | "stderr", data: string): void {
    const text = this.remainders[stream] + data;
    const lines = text.split(/\r?\n/);
    this.remainders[stream] = lines.pop() ?? "";
    for (const line of lines) this.handleLogLine(stream, line);
  }

  private flushRemainder(stream: "stdout" | "stderr"): void {
    const remainder = this.remainders[stream];
    if (remainder) {
      this.handleLogLine(stream, remainder);
      this.remainders[stream] = "";
    }
  }

  private handleLogLine(stream: LogStream, message: string): void {
    const trimmed = message.trimEnd();
    if (!trimmed) return;
    this.addLog(stream, trimmed);
    this.parseLineForState(trimmed);
  }

  private parseLineForState(message: string): void {
    // Strips ANSI escape codes from Paper's color console, and Minecraft color codes
    // so regexes don't break and we don't leak escape chars into commands.
    const cleanMessage = message.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/§[0-9a-fk-or]/ig, "");
    this.updateStateFromLog(cleanMessage);
    this.updatePlayersFromLog(cleanMessage);
    this.updateWorldTimeFromLog(cleanMessage);
    this.updatePlayerDataFromLog(cleanMessage);
  }

  // ─── Private: Orphaned process adoption ────────────────────────────────────

  private get pidPath(): string {
    return path.join(this.config.directory, "server.pid");
  }

  private get logFilePath(): string {
    return path.join(this.config.directory, "logs", "latest.log");
  }

  private isPidAlive(pid?: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e: any) {
      return e.code === "EPERM";
    }
  }

  public isOnline(): boolean {
    return this.state === "ONLINE";
  }

  private async autoSyncSkin(username: string): Promise<void> {
    try {
      const account = await prisma.minecraftAccount.findFirst({ where: { nametag: username } });
      if (!account || !account.skin) return;

      this.addLog("system", `Sincronizando skin de cuenta para ${username}...`);
      
      const localPath = path.join(process.cwd(), "public", account.skin);
      const fileBuffer = await fs.readFile(localPath);

      const formData = new FormData();
      formData.append("file", new Blob([new Uint8Array(fileBuffer)], { type: "image/png" }), "skin.png");
      formData.append("visibility", "1"); // 1 = private

      const response = await fetch("https://api.mineskin.org/generate/upload", {
        method: "POST",
        body: formData,
        headers: { "User-Agent": "MinecraftManager/1.0" }
      });

      if (!response.ok) {
        throw new Error(`MineSkin API error: ${response.status}`);
      }

      const json = await response.json();
      const textureUrl = (json as any).data?.texture?.url;
      if (textureUrl) {
        const skinName = `custom_${username}`.toLowerCase();
        this.sendCommand(`sr createcustom ${skinName} ${textureUrl}`);
        
        // Esperamos 10 segundos para que SkinsRestorer tenga tiempo de 
        // procesar la URL (es una operación asíncrona interna del plugin)
        setTimeout(() => {
          this.sendCommand(`skin set ${skinName} ${username}`);
          this.addLog("system", `Skin aplicada automáticamente a ${username}`);
        }, 10000);
      }
    } catch (e: any) {
      this.addLog("system", `Error al sincronizar skin de ${username}: ${e.message}`);
    }
  }

  private stopS3BackupTimer(): void {
    if (this.s3BackupTimer) {
      clearInterval(this.s3BackupTimer);
      this.s3BackupTimer = undefined;
    }
  }

  private startS3BackupTimer(): void {
    if (this.config.syncWithS3 !== false && !this.s3BackupTimer) {
      this.s3BackupTimer = setInterval(async () => {
        try {
          await this.s3Sync.zipAndUpload(this.config.directory, this.config.id, (msg) => this.addLog("system", msg));
        } catch (e: any) {
          this.addLog("system", `Failed to backup to S3 (Periodic): ${e.message}`);
        }
      }, 10 * 60 * 1000); // 10 minutes
    }
  }

  /**
   * Reconoce un proceso de Minecraft que siga corriendo tras un reinicio del
   * panel (proceso huérfano): lo adopta, reconstruye su estado leyendo el
   * archivo de log persistido y sigue el log por archivo.
   */
  async tryAdopt(): Promise<void> {
    // Si el proceso adoptado ya no está vivo (la JVM se reinició por otro lado o
    // crasheó), limpiar el estado para poder volver a adoptar por puerto.
    if (this.adopted && !this.isPidAlive(this.adoptedPid)) {
      this.addLog("system", `El proceso adoptado (PID ${this.adoptedPid}) ya no está vivo; se reintenta la adopción.`);
      this.adopted = false;
      this.adoptedPid = undefined;
      this.adoptionChecked = false;
      this.stopFileTail();
      this.stopS3BackupTimer();
      this.state = "OFFLINE";
    }
    if (this.adoptionChecked || this.child) return;
    this.adoptionChecked = true;
    if (this.state !== "OFFLINE") return;

    // 1) Ruta rápida: pidfile del arranque anterior
    let pid: number | undefined;
    try {
      pid = Number((await fs.readFile(this.pidPath, "utf8")).trim());
    } catch {
      // No hay pidfile: nunca se inició o terminó limpiamente
    }

    if (!this.isPidAlive(pid)) {
      // 2) Fallback: el proceso se inició antes de existir el pidfile (o sin él).
      //    Si el puerto configurado está en uso por un proceso Java, es nuestro servidor.
      pid = await this.findProcessByPort(this.config.port);
      if (pid) {
        void fs.writeFile(this.pidPath, String(pid), "utf8").catch(() => {});
      } else {
        await fs.rm(this.pidPath, { force: true }).catch(() => {});
        return;
      }
    }

    this.adopted = true;
    this.adoptedPid = pid;
    this.addLog("system", `Adoptado proceso de Minecraft existente (PID ${pid}) tras reinicio del panel.`);
    this.addLog("system", "Modo huérfano: para usar la consola y los comandos, reinicia el servidor.");

    this.readServerProperties();
    await this.scanLogFile();
    this.worldTime = null; // la hora del log es vieja; se recupera al reiniciar
    // El PID está vivo: el servidor está corriendo (o terminando de arrancar)
    this.state = "ONLINE";
    this.startFileTail();
    this.startS3BackupTimer();
  }

  /** Reconstruye el estado (jugadores, mundo, online) desde logs/latest.log. */
  private async scanLogFile(): Promise<void> {
    try {
      const stat = await fs.stat(this.logFilePath);
      if (!stat.isFile() || stat.size === 0) return;
      const content = await fs.readFile(this.logFilePath, "utf8");
      this.tailOffset = Buffer.byteLength(content);
      this.startedAt = new Date(stat.mtimeMs);
      const lines = content.split(/\r?\n/).filter((line) => line.trim());
      // Procesar todas las líneas para reconstruir el estado; guardar solo el final en el buffer
      const keepFrom = Math.max(0, lines.length - 2000);
      for (let i = 0; i < lines.length; i++) {
        this.parseLineForState(lines[i]);
        if (i >= keepFrom) this.addLog("stdout", lines[i]);
      }
    } catch {
      this.startedAt = this.startedAt ?? new Date();
    }
  }

  private startFileTail(): void {
    if (this.tailTimer) return;
    this.tailTimer = setInterval(() => this.tailLogFile(), 2000);
  }

  private stopFileTail(): void {
    if (this.tailTimer) {
      clearInterval(this.tailTimer);
      this.tailTimer = undefined;
    }
  }

  private async tailLogFile(): Promise<void> {
    if (!this.adopted || !this.isPidAlive(this.adoptedPid)) {
      const wasAdopted = this.adopted;
      this.state = "OFFLINE";
      this.adopted = false;
      this.stopFileTail();
      this.stopS3BackupTimer();
      this.addLog("system", "El proceso de Minecraft adoptado terminó.");
      await fs.rm(this.pidPath, { force: true }).catch(() => {});
      if (wasAdopted) {
        if (this.config.syncWithS3 !== false) {
          try {
            await this.s3Sync.zipAndUpload(this.config.directory, this.config.id, (msg) => this.addLog("system", msg));
          } catch (e: any) {
            this.addLog("system", `Failed to backup to S3: ${e.message}`);
          }
        }
      }
      return;
    }

    try {
      const stat = await fs.stat(this.logFilePath);
      if (stat.size < this.tailOffset) this.tailOffset = 0; // log rotado/recreado
      if (stat.size === this.tailOffset) return;
      const handle = await fs.open(this.logFilePath, "r");
      try {
        const length = stat.size - this.tailOffset;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, this.tailOffset);
        this.tailOffset = stat.size;
        for (const line of buffer.toString("utf8").split(/\r?\n/)) {
          if (line.trim()) this.handleLogLine("stdout", line);
        }
      } finally {
        await handle.close();
      }
      // Un proceso adoptado no tiene consola para consultar Pos/Dimension;
      // recuperamos la ubicación de la línea de login ("logged in ... at ([dim]x, y, z)")
      await this.refreshMissingPlayerData();
    } catch {
      // El log aún no existe (p.ej. arranque en curso)
    }
  }

  /**
   * Para procesos adoptados (sin consola): busca en el log la línea de login de
   * cada jugador en línea que aún no tenga posición/dimensión. Se hace una sola
   * vez por jugador (hasta que vuelva a entrar, donde el tail la parsea en vivo).
   */
  private async refreshMissingPlayerData(): Promise<void> {
    const missing = this.players.names.filter((name) => {
      if (this.refreshTried.has(name)) return false;
      const session = this.playerSessions[name];
      return !!session && (session.x === null || session.dimension === "unknown");
    });
    if (missing.length === 0) return;

    try {
      const content = await fs.readFile(this.logFilePath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const parsed = this.tryParsePlayerLogin(line);
        if (parsed && this.players.names.includes(parsed.name) && this.playerSessions[parsed.name]) {
          const session = this.playerSessions[parsed.name];
          session.x = parsed.x;
          session.y = parsed.y;
          session.z = parsed.z;
          session.dimension = parsed.dimension;
        }
      }
    } catch {
      // log no disponible
    }
    missing.forEach((name) => this.refreshTried.add(name));
  }

  /** Cache corto de findProcessByPort: evita re-ejecutar netstat/tasklist en cada poll. */
  private portPidCache = new Map<number, { pid?: number; at: number }>();

  /** Encuentra un proceso Java escuchando en el puerto dado (sin pidfile). */
  private async findProcessByPort(port: number): Promise<number | undefined> {
    const cached = this.portPidCache.get(port);
    if (cached && Date.now() - cached.at < 5_000) return cached.pid;

    const result = await this.findProcessByPortUncached(port);
    this.portPidCache.set(port, { pid: result, at: Date.now() });
    return result;
  }

  private async findProcessByPortUncached(port: number): Promise<number | undefined> {
    if (process.platform === "win32") {
      try {
        const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], { windowsHide: true });
        const target = `:${port}`;
        for (const line of stdout.split(/\r?\n/)) {
          if (!/LISTENING/i.test(line)) continue;
          const match = line.match(/TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)/i);
          if (match && match[1].endsWith(target)) {
            const pid = Number(match[2]);
            if (await this.isJavaProcess(pid)) return pid;
          }
        }
      } catch {
        // netstat no disponible
      }
      return undefined;
    }

    // Linux: /proc/net/tcp(+6) → inode del socket → /proc/*/fd → cmdline java
    try {
      const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
      const sockets = new Map<string, string>(); // inode → pid
      const fdDirs = await fs.readdir("/proc");
      for (const entry of fdDirs) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const fds = await fs.readdir(`/proc/${entry}/fd`);
          for (const fd of fds) {
            try {
              const link = await fs.readlink(`/proc/${entry}/fd/${fd}`);
              const inode = link.match(/^socket:\[(\d+)\]$/)?.[1];
              if (inode) sockets.set(inode, entry);
            } catch { /* fd cerrado */ }
          }
        } catch { /* proceso desaparecido */ }
      }
      for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
        let content: string;
        try {
          content = await fs.readFile(file, "utf8");
        } catch {
          continue;
        }
        for (const line of content.split(/\r?\n/).slice(1)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 10) continue;
          if (parts[3] !== "0A") continue; // 0A = LISTEN
          const local = parts[1]; // HEX_IP:HEX_PORT
          if (local.endsWith(`:${hexPort}`)) {
            const inode = parts[9];
            const pid = sockets.get(inode);
            if (pid && await this.isJavaProcess(Number(pid))) return Number(pid);
          }
        }
      }
    } catch {
      // /proc no disponible
    }
    return undefined;
  }

  private async isJavaProcess(pid: number): Promise<boolean> {
    try {
      if (process.platform === "win32") {
        // tasklist es mucho más rápido que wmic (que en Windows puede tardar 1-2s por llamada)
        const { stdout } = await execFileAsync("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"], { windowsHide: true });
        return /java/i.test(stdout);
      }
      const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, "utf8");
      return /java/i.test(cmdline);
    } catch {
      return false;
    }
  }

  private async killPid(pid: number): Promise<void> {
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/F", "/PID", String(pid)], { windowsHide: true });
        killer.on("exit", () => resolve());
        killer.on("error", () => resolve());
      });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // ya no existe
      }
    }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (!this.isPidAlive(pid)) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  private updateStateFromLog(message: string): void {
    if (this.state === "STARTING" && (/\bDone \([\d.]+s\)!/i.test(message) || /Server started\./i.test(message))) {
      this.state = "ONLINE";
      this.autoRepairAttempts = 0;
      this.addLog("system", "Minecraft is ONLINE.");
      this.startPolling();
      this.executePendingCommands();
      this.startS3BackupTimer();
    }
  }

  private async executePendingCommands(): Promise<void> {
    try {
      const commands = await prisma.$queryRaw<any[]>`
        SELECT id, command FROM serverpendingcommand WHERE serverId = ${this.config.id} ORDER BY createdAt ASC
      `;
      if (commands && commands.length > 0) {
        this.addLog("system", `Ejecutando ${commands.length} comandos pendientes...`);
        for (const row of commands) {
          try {
            this.writeRawCommand(row.command);
            this.addLog("system", `> ${row.command}`);
            await prisma.$executeRaw`DELETE FROM serverpendingcommand WHERE id = ${row.id}`;
          } catch (e: any) {
            this.addLog("system", `Error ejecutando comando pendiente: ${e.message}`);
          }
        }
      }
    } catch (e: any) {
      this.addLog("system", `Error comprobando comandos pendientes: ${e.message}`);
    }
  }

  private updatePlayersFromLog(message: string): void {
    // /list response
    const listMatch = message.match(/There are (?<count>\d+) of a max of (?<max>\d+) players online:?\s*(?<names>.*)$/i);
    if (listMatch?.groups) {
      const names = listMatch.groups.names.split(",").map((name) => name.trim()).filter(Boolean);
      this.players = { count: Number(listMatch.groups.count), max: Number(listMatch.groups.max), names };
      const now = new Date();
      names.forEach((name) => {
        if (!this.playerSessions[name]) {
          this.playerSessions[name] = { join: now, total: 0, dimension: "unknown", x: null, y: null, z: null };
          this.loadPlayerPlaytime(name);
        } else if (!this.playerSessions[name].join) {
          this.playerSessions[name].join = now;
        }
      });
      return;
    }

    // Player joined (Java and Bedrock)
    const joinedMatch = message.match(/: (?<name>[A-Za-z0-9_]{1,16}) joined the game$/) || message.match(/Player connected: (?<name>[A-Za-z0-9_]{1,16}), xuid:/);
    if (joinedMatch?.groups) {
      const name = joinedMatch.groups.name;
      const now = new Date();
      if (!this.players.names.includes(name)) {
        this.players = {
          ...this.players,
          count: this.players.count + 1,
          names: [...this.players.names, name]
        };
      }
      
      const existing = this.playerSessions[name];
      this.playerSessions[name] = {
        join: now,
        total: existing?.total ?? 0,
        dimension: existing?.dimension ?? "unknown",
        x: existing?.x ?? null,
        y: existing?.y ?? null,
        z: existing?.z ?? null
      };
      if (!existing || existing.total === 0) {
        this.loadPlayerPlaytime(name);
      }

      // Auto-sync account skin
      if (!this.syncedSkins.has(name)) {
        this.syncedSkins.add(name);
        setTimeout(() => this.autoSyncSkin(name), 5000);
      }
      
      return;
    }

    // Player left (Java and Bedrock)
    const leftMatch = message.match(/: (?<name>[A-Za-z0-9_]{1,16}) left the game$/) || message.match(/Player disconnected: (?<name>[A-Za-z0-9_]{1,16}), xuid:/);
    if (leftMatch?.groups) {
      const name = leftMatch.groups.name;
      const now = new Date();
      const session = this.playerSessions[name];
      if (session?.join) {
        const diff = (now.getTime() - session.join.getTime()) / 1000;
        session.total += diff;
        delete session.join;
        this.savePlayerPlaytime(name, Math.floor(session.total));
      }
      const names = this.players.names.filter((n) => n !== name);
      this.players = { ...this.players, count: Math.max(0, names.length), names };
      return;
    }

    // Parse death messages (if it matches a player name but isn't a chat message or join/leave)
    // Only attempt if we have at least one online player
    if (this.players.names.length > 0) {
      // Chat messages typically have <Name> or [Name]. We match generic strings starting with the player's name.
      const deathMatch = message.match(/\]: (?<name>[A-Za-z0-9_]{1,16}) (?<reason>(fell|was|blew|burned|tried|hit|died|withered|drowned|starved|suffocated|froze|went off|experienced|walked into|discovered|impaled|squashed|shot).*)$/);
      if (deathMatch?.groups && this.players.names.includes(deathMatch.groups.name)) {
        const name = deathMatch.groups.name;
        const reason = deathMatch.groups.reason;
        
        // Exclude achievements
        if (!reason.includes("has made the advancement") && !reason.includes("has completed the challenge")) {
          const dimension = this.playerSessions[name]?.dimension || "minecraft:overworld";
          
          // Prioritize exact player + dimension match
          let template = this.deathMessages.find(m => m.dimension === dimension && m.playerName === name)?.message;
          // Next, player + any dimension (*)
          if (!template) {
            template = this.deathMessages.find(m => m.dimension === "*" && m.playerName === name)?.message;
          }
          // Next, generic dimension message
          if (!template) {
            template = this.deathMessages.find(m => m.dimension === dimension && (!m.playerName || m.playerName === ''))?.message;
          }
          // Fallback to generic message (*)
          if (!template) {
            template = this.deathMessages.find(m => m.dimension === "*" && (!m.playerName || m.playerName === ''))?.message;
          }

          if (template) {
            const finalMessage = template.replace(/{player}/g, name).replace(/{reason}/g, reason);
            // Send tellraw to everyone
            const tellraw = `tellraw @a {"text":"${finalMessage}","color":"yellow"}`;
            this.writeRawCommand(tellraw);
          }
        }
      }
    }
  }

  private async loadPlayerPlaytime(name: string) {
    try {
      const rows = await prisma.$queryRaw<any[]>`SELECT playtimeSeconds FROM serverplayer WHERE serverId = ${this.config.id} AND name = ${name}`;
      if (rows && rows.length > 0) {
        const dbTotal = Number(rows[0].playtimeSeconds);
        if (this.playerSessions[name]) {
          this.playerSessions[name].total = dbTotal;
        }
      }
    } catch (e) {
      console.error("[MinecraftService] Error loading playtime for", name, e);
    }
  }

  private async savePlayerPlaytime(name: string, total: number) {
    try {
      // Usar $executeRaw para interactuar con la tabla serverplayer sin depender del schema generado
      await prisma.$executeRaw`
        INSERT INTO serverplayer (serverId, name, playtimeSeconds, lastSeen, createdAt)
        VALUES (${this.config.id}, ${name}, ${total}, NOW(), NOW())
        ON DUPLICATE KEY UPDATE playtimeSeconds = ${total}, lastSeen = NOW()
      `;
    } catch (e) {
      console.error("[MinecraftService] Error saving playtime for", name, e);
    }
  }

  private updateWorldTimeFromLog(message: string): void {
    // Response to: time query daytime
    // Format: "The time is 6000"
    const timeMatch = message.match(/The time is (\d+)/i);
    if (timeMatch) {
      this.worldTime = parseInt(timeMatch[1], 10);
    }
  }

  /**
   * Parsea la línea de login del servidor, que incluye la posición inicial y la
   * dimensión: "<name>[/127.0.0.1:port] logged in with entity id N at ([dim]x, y, z)".
   */
  private tryParsePlayerLogin(message: string): { name: string; x: number; y: number; z: number; dimension: Dimension } | null {
    const match = message.match(/: ([A-Za-z0-9_]{1,16})\[\S+\] logged in with entity id \d+ at \(\[([A-Za-z0-9_]+)\](-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\)/);
    if (!match) return null;
    const dimFolder = match[2].toLowerCase();
    const dimension: Dimension = dimFolder.includes("_nether")
      ? "nether"
      : dimFolder.includes("end")
        ? "end"
        : "overworld";
    return {
      name: match[1],
      x: Math.round(parseFloat(match[3])),
      y: Math.round(parseFloat(match[4])),
      z: Math.round(parseFloat(match[5])),
      dimension
    };
  }

  private updatePlayerDataFromLog(message: string): void {
    // Línea de login del jugador (funciona también sin consola, p.ej. adoptados)
    const login = this.tryParsePlayerLogin(message);
    if (login && this.playerSessions[login.name]) {
      const session = this.playerSessions[login.name];
      session.x = login.x;
      session.y = login.y;
      session.z = login.z;
      session.dimension = login.dimension;
      return;
    }

    // Response to: data get entity <name> Pos
    // Format (Paper/Vanilla): "<name> has the following entity data: [X.0d, Y.0d, Z.0d]"
    // or: "Data of entity <name>: [X.0d, Y.0d, Z.0d]"
    const posMatch = message.match(/(?:has the following entity data|Data of entity [^:]+):\s*\[(-?[\d.]+)d,\s*(-?[\d.]+)d,\s*(-?[\d.]+)d\]/i);
    if (posMatch) {
      // Find which player this belongs to by checking recent context — use name from message
      const nameFromMsg = this.extractPlayerNameFromDataMsg(message);
      if (nameFromMsg && this.playerSessions[nameFromMsg]) {
        this.playerSessions[nameFromMsg].x = Math.round(parseFloat(posMatch[1]));
        this.playerSessions[nameFromMsg].y = Math.round(parseFloat(posMatch[2]));
        this.playerSessions[nameFromMsg].z = Math.round(parseFloat(posMatch[3]));
      }
      return;
    }

    // Response to: data get entity <name> Dimension
    // Format: "<name> has the following entity data: "minecraft:overworld""
    const dimMatch = message.match(/(?:has the following entity data|Data of entity [^:]+):\s*"minecraft:(overworld|the_nether|the_end)"/i);
    if (dimMatch) {
      const nameFromMsg = this.extractPlayerNameFromDataMsg(message);
      if (nameFromMsg && this.playerSessions[nameFromMsg]) {
        const raw = dimMatch[1].toLowerCase();
        const dim: Dimension = raw === "overworld" ? "overworld" : raw === "the_nether" ? "nether" : raw === "the_end" ? "end" : "unknown";
        this.playerSessions[nameFromMsg].dimension = dim;
      }
    }
  }

  /**
   * Attempt to extract a player name from a "data get entity" response line.
   * Paper logs it as: [server thread/INFO]: <Name> has the following entity data: ...
   */
    private extractPlayerNameFromDataMsg(message: string): string | null {
      const match1 = message.match(/\]:?\s*([A-Za-z0-9_]{1,16})\s+has the following entity data/i);
      if (match1) return match1[1];
      
      const match2 = message.match(/Data of entity ([A-Za-z0-9_]{1,16}):/i);
      if (match2) return match2[1];

      return null;
    }

  private addLog(stream: LogStream, message: string): void {
    const timestamp = new Date();
    const entry: LogEntry = {
      id: this.nextLogId,
      timestamp: timestamp.toISOString(),
      stream,
      message
    };
    this.nextLogId += 1;
    this.logs.push(entry);
    this.emit("log", entry);
    
    // Add to DB batch
    let level = "INFO";
    if (stream === "stderr" || message.includes("WARN")) level = "WARN";
    if (message.includes("ERROR") || message.includes("Exception") || message.includes("FATAL")) level = "ERROR";
    
    this.pendingDbLogs.push({
      level,
      message,
      createdAt: timestamp
    });
    
    // Safety check: flush immediately if we have too many pending logs (e.g. startup)
    if (this.pendingDbLogs.length >= 200) {
      this.flushLogsToDb();
    }
  }
}
