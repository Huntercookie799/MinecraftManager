import { MinecraftService, type MinecraftServerConfig } from "./MinecraftService";

export class ServerManager {
  private servers: Map<number, MinecraftService> = new Map();

  getService(config: MinecraftServerConfig): MinecraftService {
    let service = this.servers.get(config.id);
    if (!service) {
      service = new MinecraftService(config);
      this.servers.set(config.id, service);
      // Un proceso de Minecraft que sobrevivió a un reinicio del panel se adopta solo.
      void service.tryAdopt();
    }
    return service;
  }

  getServiceById(id: number): MinecraftService | undefined {
    return this.servers.get(id);
  }

  removeService(id: number): void {
    const service = this.servers.get(id);
    if (service) {
      service.dispose();
      this.servers.delete(id);
    }
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.servers.values()).map(service => service.stop());
    await Promise.allSettled(promises);
  }

  async adoptAll(): Promise<void> {
    await Promise.allSettled(Array.from(this.servers.values()).map(service => service.tryAdopt()));
  }
}

export const serverManager = new ServerManager();
