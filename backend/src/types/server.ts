export type ServerState = "OFFLINE" | "STARTING" | "ONLINE" | "STOPPING" | "ERROR";

export type LogStream = "stdout" | "stderr" | "system";

export type Dimension = "overworld" | "nether" | "end" | "unknown";

export interface PlayerInfo {
  name: string;
  online: boolean;
  playtimeSeconds: number;
  dimension: Dimension;
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  stream: LogStream;
  message: string;
}

export interface ServerStatus {
  status: ServerState;
  players: number;
  maxPlayers: number;
  playerNames: string[];
  world: string;
  uptime: number;
  pid?: number;
  startedAt?: string;
  lastError?: string;
  version?: string;
  ip?: string;
  memory?: string;
  port?: number;
  worldTime?: number | null;
  playersInfo?: PlayerInfo[];
}
