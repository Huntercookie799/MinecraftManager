import os from "node:os";

/**
 * Detecta la IP LAN real priorizando la red física (Wi-Fi/Ethernet) sobre
 * adaptadores virtuales (ZeroTier, Teredo, VM, Docker...). La IP la asigna el
 * DHCP del router y puede cambiar entre reinicios; el panel siempre debe
 * mostrar la vigente para que el bloque `hosts` de la LAN siga funcionando.
 */
export function getLanIp(): string {
  const nets = os.networkInterfaces();
  const candidates: { name: string; address: string; score: number }[] = [];

  const isVirtual = /zerotier|teredo|vethernet|hyper-v|virtualbox|vmware|docker|tailscale|hamachi|wsl|loopback|pseudo/i;
  const isPhysical = /wi-?fi|ethernet|wireless|lan/i;

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      let score = 0;
      if (isPhysical.test(name)) score = 2;
      if (isVirtual.test(name)) score = -2;
      candidates.push({ name, address: net.address, score });
    }
  }

  // Preferir la interfaz física; entre varias, la primera (orden de Windows).
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? "127.0.0.1";
}

export interface NetAddressInfo {
  family: string;
  address: string;
  internal: boolean;
}

export interface NetInterfaceInfo {
  name: string;
  addresses: NetAddressInfo[];
}

/** Lista todas las interfaces de red (nombre -> direcciones IPv4/IPv6). */
export function getNetworkInterfaces(): NetInterfaceInfo[] {
  const nets = os.networkInterfaces();
  const result: NetInterfaceInfo[] = [];
  for (const name of Object.keys(nets)) {
    const addresses = (nets[name] || [])
      .map((net) => ({
        family: String(net.family),
        address: net.address,
        internal: net.internal
      }))
      .sort((a, b) => (a.family === "IPv4" ? -1 : 1) - (b.family === "IPv4" ? -1 : 1));
    if (addresses.length > 0) {
      result.push({ name, addresses });
    }
  }
  return result;
}
