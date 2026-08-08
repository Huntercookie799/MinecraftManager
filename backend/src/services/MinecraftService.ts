import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import type { Dimension, LogEntry, LogStream, PlayerInfo, ServerState, ServerStatus } from "../types/server";
import { RingBuffer } from "../utils/ringBuffer";

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

import { S3SyncService } from "./S3SyncService";

export interface MinecraftServerConfig {
  id: number;
  name: string;
  directory: string;
  port: number;
  memory: string;
}

type ServiceErrorCode =
  | "COMMAND_REJECTED"
  | "EULA_NOT_ACCEPTED"
  | "MINECRAFT_NOT_RUNNING"
  | "PAPER_JAR_MISSING";

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
  private worldTime: number | null = null;
  private pollingTimer?: NodeJS.Timeout;

  // Track per-player join times, total playtime (seconds), dimension and coords
  private playerSessions: Record<string, PlayerSession> = {};

  // Used to correlate pending data queries
  private pendingDataQuery: string | null = null;

  private s3Sync: S3SyncService;

  constructor(public readonly config: MinecraftServerConfig) {
    super();
    this.s3Sync = new S3SyncService();
  }

  async start(): Promise<ServerStatus> {
    if (this.child && !this.child.killed) {
      return this.getStatus();
    }

    await this.ensureRuntimeIsReady();
    await this.ensureServerProperties();
    this.readServerProperties();

    this.state = "STARTING";
    this.startedAt = new Date();
    this.lastError = undefined;
    
    // S3: Restaurar desde el backup antes de arrancar
    try {
      await this.s3Sync.downloadAndUnzip(this.config.directory, (msg) => this.addLog("system", msg));
    } catch (e: any) {
      this.addLog("system", `Failed to sync from S3: ${e.message}`);
    }

    this.addLog("system", `Starting Minecraft from ${this.config.directory}`);

    const args = ["-Xms" + this.config.memory, "-Xmx" + this.config.memory, "-jar", env.paperJar, "nogui"];

    const child = spawn(env.javaBin, args, {
      cwd: this.config.directory,
      env: process.env,
      stdio: "pipe",
      windowsHide: true
    });

    this.child = child;

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
      this.state = expectedStop ? "OFFLINE" : "ERROR";
      this.stopPolling();

      if (!expectedStop) {
        this.lastError = `Minecraft exited unexpectedly with code ${code ?? "null"}.`;
      }

      // S3: Crear un backup tras apagarse (esperado o inesperado)
      try {
        await this.s3Sync.zipAndUpload(this.config.directory, (msg) => this.addLog("system", msg));
      } catch (e: any) {
        this.addLog("system", `Failed to backup to S3: ${e.message}`);
      }
    });

    return this.getStatus();
  }

  async stop(): Promise<ServerStatus> {
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
    if (!this.child || this.child.killed || this.state === "OFFLINE") {
      throw new MinecraftServiceError("Minecraft is not running.", 409, "MINECRAFT_NOT_RUNNING");
    }

    const command = this.normalizeCommand(rawCommand);
    this.writeRawCommand(command);
    this.addLog("system", `> ${command}`);

    return { accepted: true, command };
  }

  getStatus(): ServerStatus {
    const uptime = this.startedAt ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000) : 0;
    const now = new Date();

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
      status: this.state,
      players: this.players.count,
      maxPlayers: this.players.max,
      playerNames: this.players.names,
      world: this.world,
      uptime,
      pid: this.child?.pid,
      startedAt: this.startedAt?.toISOString(),
      lastError: this.lastError,
      version: process.env.MINECRAFT_VERSION ? `Purpur ${process.env.MINECRAFT_VERSION}` : "Purpur 1.21.x",
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
    if (!this.child || this.child.killed) return;
    await this.stop();
  }

  // ─── Private: Polling ────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollingTimer) return;
    // Run immediately, then every 10s
    this.runPollingCycle();
    this.pollingTimer = setInterval(() => this.runPollingCycle(), 10_000);
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  private runPollingCycle(): void {
    if (this.state !== "ONLINE" || !this.child || this.child.killed) return;

    // Query world time
    this.writeRawCommand("time query daytime");

    // Query each online player's dimension and position
    for (const name of this.players.names) {
      this.writeRawCommand(`data get entity ${name} Pos`);
      this.writeRawCommand(`data get entity ${name} Dimension`);
    }
  }

  // ─── Private: Setup ──────────────────────────────────────────────────────────

  private async ensureRuntimeIsReady(): Promise<void> {
    await fs.mkdir(this.config.directory, { recursive: true });
    await this.ensurePaperJarExists();
    await this.ensureEulaAccepted();
  }

  private async ensurePaperJarExists(): Promise<void> {
    try {
      await fs.access(env.paperJar);
    } catch {
      throw new MinecraftServiceError(
        `Paper jar not found at ${env.paperJar}. Run "npm run minecraft:download" first.`,
        409,
        "PAPER_JAR_MISSING"
      );
    }
  }

  private async ensureEulaAccepted(): Promise<void> {
    const eulaPath = path.join(this.config.directory, "eula.txt");
    await fs.writeFile(eulaPath, "eula=true\n", "utf8");
  }

  private async ensureServerProperties(): Promise<void> {
    const propPath = path.join(this.config.directory, "server.properties");
    try {
      let content = await fs.readFile(propPath, "utf8");
      if (!content.includes(`server-port=${this.config.port}`)) {
        if (content.includes("server-port=")) {
          content = content.replace(/server-port=\d+/, `server-port=${this.config.port}`);
        } else {
          content += `\nserver-port=${this.config.port}\n`;
        }
        await fs.writeFile(propPath, content, "utf8");
      }
    } catch {
      await fs.writeFile(propPath, `server-port=${this.config.port}\n`, "utf8");
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
    this.child?.stdin.write(`${command}\n`);
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
    this.updateStateFromLog(trimmed);
    this.updatePlayersFromLog(trimmed);
    this.updateWorldTimeFromLog(trimmed);
    this.updatePlayerDataFromLog(trimmed);
  }

  private updateStateFromLog(message: string): void {
    if (this.state === "STARTING" && /\bDone \([\d.]+s\)!/i.test(message)) {
      this.state = "ONLINE";
      this.addLog("system", "Minecraft is ONLINE.");
      this.startPolling();
    }
  }

  private updatePlayersFromLog(message: string): void {
    // /list response
    const listMatch = message.match(/There are (?<count>\d+) of a max of (?<max>\d+) players online:?\s*(?<names>.*)$/i);
    if (listMatch?.groups) {
      const names = listMatch.groups.names.split(",").map((name) => name.trim()).filter(Boolean);
      this.players = { count: Number(listMatch.groups.count), max: Number(listMatch.groups.max), names };
      names.forEach((name) => {
        if (!this.playerSessions[name]) {
          this.playerSessions[name] = { total: 0, dimension: "unknown", x: null, y: null, z: null };
        }
      });
      return;
    }

    // Player joined
    const joinedMatch = message.match(/: (?<name>[A-Za-z0-9_]{1,16}) joined the game$/);
    if (joinedMatch?.groups && !this.players.names.includes(joinedMatch.groups.name)) {
      const name = joinedMatch.groups.name;
      const now = new Date();
      this.players = {
        ...this.players,
        count: this.players.count + 1,
        names: [...this.players.names, name]
      };
      const existing = this.playerSessions[name];
      this.playerSessions[name] = {
        join: now,
        total: existing?.total ?? 0,
        dimension: existing?.dimension ?? "unknown",
        x: existing?.x ?? null,
        y: existing?.y ?? null,
        z: existing?.z ?? null
      };
      return;
    }

    // Player left
    const leftMatch = message.match(/: (?<name>[A-Za-z0-9_]{1,16}) left the game$/);
    if (leftMatch?.groups) {
      const name = leftMatch.groups.name;
      const now = new Date();
      const session = this.playerSessions[name];
      if (session?.join) {
        const diff = (now.getTime() - session.join.getTime()) / 1000;
        session.total += diff;
        delete session.join;
      }
      const names = this.players.names.filter((n) => n !== name);
      this.players = { ...this.players, count: Math.max(0, names.length), names };
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

  private updatePlayerDataFromLog(message: string): void {
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
    // Match log prefix pattern: "[HH:MM:SS INFO]: <Name> has..."
    const match = message.match(/\]\s*([A-Za-z0-9_]{1,16})\s+has the following entity data/i);
    if (match) return match[1];
    return null;
  }

  private addLog(stream: LogStream, message: string): void {
    const entry: LogEntry = {
      id: this.nextLogId,
      timestamp: new Date().toISOString(),
      stream,
      message
    };
    this.nextLogId += 1;
    this.logs.push(entry);
    this.emit("log", entry);
  }
}
