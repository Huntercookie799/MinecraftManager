import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import type { LogEntry, LogStream, ServerState, ServerStatus } from "../types/server";
import { RingBuffer } from "../utils/ringBuffer";

interface PlayerState {
  count: number;
  max: number;
  names: string[];
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

  async start(): Promise<ServerStatus> {
    if (this.child && !this.child.killed) {
      return this.getStatus();
    }

    await this.ensureRuntimeIsReady();
    this.readServerProperties();

    this.state = "STARTING";
    this.startedAt = new Date();
    this.lastError = undefined;
    this.addLog("system", `Starting Minecraft from ${env.minecraftDir}`);

    const child = spawn(env.javaBin, [...env.javaArgs, "-jar", env.paperJar, "nogui"], {
      cwd: env.minecraftDir,
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
    });

    child.once("exit", (code, signal) => {
      this.flushRemainder("stdout");
      this.flushRemainder("stderr");

      const expectedStop = this.state === "STOPPING" || code === 0;
      this.addLog("system", `Minecraft exited with code ${code ?? "null"} and signal ${signal ?? "null"}`);

      this.child = undefined;
      this.startedAt = undefined;
      this.players = { ...this.players, count: 0, names: [] };
      this.state = expectedStop ? "OFFLINE" : "ERROR";

      if (!expectedStop) {
        this.lastError = `Minecraft exited unexpectedly with code ${code ?? "null"}.`;
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

    return {
      status: this.state,
      players: this.players.count,
      maxPlayers: this.players.max,
      playerNames: this.players.names,
      world: this.world,
      uptime,
      pid: this.child?.pid,
      startedAt: this.startedAt?.toISOString(),
      lastError: this.lastError
    };
  }

  getLogs(sinceId?: number): LogEntry[] {
    const logs = this.logs.toArray();

    if (!sinceId) {
      return logs;
    }

    return logs.filter((entry) => entry.id > sinceId);
  }

  async dispose(): Promise<void> {
    if (!this.child || this.child.killed) {
      return;
    }

    await this.stop();
  }

  private async ensureRuntimeIsReady(): Promise<void> {
    await fs.mkdir(env.minecraftDir, { recursive: true });
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
    const eulaPath = path.join(env.minecraftDir, "eula.txt");

    try {
      const eula = await fs.readFile(eulaPath, "utf8");

      if (/^eula=true\s*$/im.test(eula)) {
        return;
      }
    } catch {
      await fs.writeFile(eulaPath, "eula=false\n", "utf8");
    }

    throw new MinecraftServiceError(
      `Minecraft EULA is not accepted. Edit ${eulaPath} and set eula=true after reading the official EULA.`,
      409,
      "EULA_NOT_ACCEPTED"
    );
  }

  private readServerProperties(): void {
    void fs.readFile(path.join(env.minecraftDir, "server.properties"), "utf8")
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

    if (!command) {
      throw new MinecraftServiceError("Command cannot be empty.", 400, "COMMAND_REJECTED");
    }

    if (/[\r\n]/.test(command)) {
      throw new MinecraftServiceError("Command must be a single line.", 400, "COMMAND_REJECTED");
    }

    if (command.length > env.commandMaxLength) {
      throw new MinecraftServiceError(
        `Command is too long. Maximum length is ${env.commandMaxLength} characters.`,
        400,
        "COMMAND_REJECTED"
      );
    }

    return command;
  }

  private writeRawCommand(command: string): void {
    this.child?.stdin.write(`${command}\n`);
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    const child = this.child;

    if (!child) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let forceTimer: NodeJS.Timeout | undefined;

      const timeout = setTimeout(() => {
        this.addLog("system", `Minecraft did not stop within ${timeoutMs}ms; killing process.`);
        child.kill("SIGTERM");

        forceTimer = setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 5_000);
      }, timeoutMs);

      child.once("exit", () => {
        clearTimeout(timeout);

        if (forceTimer) {
          clearTimeout(forceTimer);
        }

        resolve();
      });
    });
  }

  private consumeStream(stream: "stdout" | "stderr", data: string): void {
    const text = this.remainders[stream] + data;
    const lines = text.split(/\r?\n/);
    this.remainders[stream] = lines.pop() ?? "";

    for (const line of lines) {
      this.handleLogLine(stream, line);
    }
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

    if (!trimmed) {
      return;
    }

    this.addLog(stream, trimmed);
    this.updateStateFromLog(trimmed);
    this.updatePlayersFromLog(trimmed);
  }

  private updateStateFromLog(message: string): void {
    if (this.state === "STARTING" && /\bDone \([\d.]+s\)!/i.test(message)) {
      this.state = "ONLINE";
      this.addLog("system", "Minecraft is ONLINE.");
    }
  }

  private updatePlayersFromLog(message: string): void {
    const listMatch = message.match(/There are (?<count>\d+) of a max of (?<max>\d+) players online:?\s*(?<names>.*)$/i);

    if (listMatch?.groups) {
      const names = listMatch.groups.names
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);

      this.players = {
        count: Number(listMatch.groups.count),
        max: Number(listMatch.groups.max),
        names
      };
      return;
    }

    const joinedMatch = message.match(/: (?<name>[A-Za-z0-9_]{1,16}) joined the game$/);
    if (joinedMatch?.groups && !this.players.names.includes(joinedMatch.groups.name)) {
      this.players = {
        ...this.players,
        count: this.players.count + 1,
        names: [...this.players.names, joinedMatch.groups.name]
      };
      return;
    }

    const leftMatch = message.match(/: (?<name>[A-Za-z0-9_]{1,16}) left the game$/);
    if (leftMatch?.groups) {
      const names = this.players.names.filter((name) => name !== leftMatch.groups?.name);
      this.players = {
        ...this.players,
        count: Math.max(0, names.length),
        names
      };
    }
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
