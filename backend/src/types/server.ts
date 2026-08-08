export type ServerState = "OFFLINE" | "STARTING" | "ONLINE" | "STOPPING" | "ERROR";

export type LogStream = "stdout" | "stderr" | "system";

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
}
