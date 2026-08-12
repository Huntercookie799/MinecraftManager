import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProcessStats {
  pid: number;
  rssMB: number;
  cpuPercent: number;
  cpuSeconds: number;
}

interface CpuSample {
  idle: number;
  total: number;
}

interface ProcessSample {
  rssMB: number;
  cpuSeconds: number;
}

interface ProcessCacheEntry {
  at: number;
  stats: ProcessStats;
}

const PROCESS_CACHE_MS = 2000;
const MIN_CPU_SAMPLE_MS = 500;

/**
 * Monitoreo de rendimiento: CPU/RAM del sistema y de los procesos
 * de Minecraft. Los valores de proceso se consultan a PowerShell en
 * Windows (o /proc en Linux) y se cachean unos segundos para no
 * saturar el endpoint cuando el panel se refresca seguido.
 */
export class SystemMonitorService {
  private cpuSample: CpuSample | null = null;
  private processCache = new Map<number, ProcessCacheEntry>();
  private prevProcess = new Map<number, { cpuSeconds: number; at: number }>();

  constructor() {
    // Muestreo base para que la primera consulta de CPU ya tenga referencia.
    this.cpuSample = this.readCpuSample();
  }

  private readCpuSample(): CpuSample {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }
    return { idle, total };
  }

  /** % de CPU del sistema entre la última consulta y esta (0 en la primera). */
  getCpuPercent(): number {
    const now = this.readCpuSample();
    const prev = this.cpuSample;
    this.cpuSample = now;
    if (!prev) return 0;
    const totalDelta = now.total - prev.total;
    const idleDelta = now.idle - prev.idle;
    if (totalDelta <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
  }

  async getSystemStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      cpuPercent: this.getCpuPercent(),
      cpuCount: os.cpus().length,
      loadAvg: os.loadavg().slice(0, 3).map((x) => Number(x.toFixed(2))),
      totalMemMB: Math.round(totalMem / 1024 / 1024),
      usedMemMB: Math.round((totalMem - freeMem) / 1024 / 1024),
      freeMemMB: Math.round(freeMem / 1024 / 1024),
      uptimeSeconds: Math.floor(os.uptime())
    };
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async readProcessSamples(pids: number[]): Promise<Map<number, ProcessSample>> {
    const result = new Map<number, ProcessSample>();
    if (pids.length === 0) return result;

    try {
      if (process.platform === "win32") {
        // Un solo llamado a PowerShell para todos los PIDs.
        const ids = pids.join(",");
        const { stdout } = await execFileAsync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | Select-Object Id, WorkingSet64, CPU | ConvertTo-Json -Compress`
          ],
          { timeout: 5000, windowsHide: true }
        );
        const text = stdout.trim();
        if (!text) return result;
        const parsed = JSON.parse(text);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        for (const row of rows) {
          const pid = Number(row.Id);
          result.set(pid, {
            rssMB: Math.round((Number(row.WorkingSet64) || 0) / 1024 / 1024),
            cpuSeconds: Number(row.CPU) || 0
          });
        }
      } else {
        // Linux: /proc/<pid>/stat (utime+stime) y /proc/<pid>/status (VmRSS)
        for (const pid of pids) {
          try {
            const stat = (await import("node:fs/promises")).readFile(`/proc/${pid}/stat`, "utf8");
            const status = (await import("node:fs/promises")).readFile(`/proc/${pid}/status`, "utf8");
            const [statText, statusText] = await Promise.all([stat, status]);
            const afterParen = statText.slice(statText.lastIndexOf(")") + 1).trim().split(/\s+/);
            const utime = Number(afterParen[11]) || 0;
            const stime = Number(afterParen[12]) || 0;
            const rssPages = Number(statusText.match(/VmRSS:\s+(\d+)/)?.[1]) || 0;
            result.set(pid, {
              // VmRSS está en KB → MB
              rssMB: Math.round(rssPages / 1024),
              cpuSeconds: (utime + stime) / 100
            });
          } catch {
            /* proceso murió entre medio */
          }
        }
      }
    } catch {
      /* ignorar: el proceso puede haber muerto */
    }
    return result;
  }

  /**
   * Devuelve RSS y % de CPU por proceso (cacheado ~2s). Los procesos que ya
   * no existen no aparecen en el mapa.
   */
  async getProcessStats(pids: number[]): Promise<Map<number, ProcessStats>> {
    const unique = Array.from(new Set(pids.filter((p) => p && this.isPidAlive(p))));
    const result = new Map<number, ProcessStats>();
    const toFetch: number[] = [];

    for (const pid of unique) {
      const cached = this.processCache.get(pid);
      if (cached && Date.now() - cached.at < PROCESS_CACHE_MS) {
        result.set(pid, cached.stats);
      } else {
        toFetch.push(pid);
      }
    }

    if (toFetch.length === 0) return result;

    const samples = await this.readProcessSamples(toFetch);
    const now = Date.now();

    for (const pid of toFetch) {
      const sample = samples.get(pid);
      if (!sample) {
        this.processCache.delete(pid);
        this.prevProcess.delete(pid);
        continue;
      }

      let cpuPercent = 0;
      const prev = this.prevProcess.get(pid);
      if (prev) {
        const elapsedSec = (now - prev.at) / 1000;
        if (elapsedSec >= MIN_CPU_SAMPLE_MS / 1000) {
          const delta = Math.max(0, sample.cpuSeconds - prev.cpuSeconds);
          cpuPercent = Math.min(100, Math.max(0, Math.round((delta / elapsedSec) * 100)));
        }
      }
      this.prevProcess.set(pid, { cpuSeconds: sample.cpuSeconds, at: now });

      const stats: ProcessStats = {
        pid,
        rssMB: sample.rssMB,
        cpuPercent,
        cpuSeconds: Number(sample.cpuSeconds.toFixed(1))
      };
      this.processCache.set(pid, { at: now, stats });
      result.set(pid, stats);
    }

    return result;
  }
}

export const systemMonitor = new SystemMonitorService();
