import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';

export class ServerHeader {
  static async init() {
    if (!API.token) {
      API.logout();
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const serverId = urlParams.get('id');

    if (!serverId) {
      window.location.href = '/dashboard.html';
      return;
    }

    // Set initial static info
    const all = await ServerModel.getAll();
    if (all) {
      const server = all.find(s => s.id == serverId);
      if (server) {
        const nameEl = DOM.get('current-server-name');
        const infoEl = DOM.get('current-server-info');
        if (nameEl) nameEl.textContent = server.name;
        if (infoEl) infoEl.textContent = `Puerto: ${server.port} | RAM: ${server.memory}`;
        
        // Avatar
        if (server.avatar) {
          ServerHeader.setAvatar(server.avatar);
        }
        
        // Accent color
        if (server.accentColor) {
          ServerHeader.setAccentColor(server.accentColor);
        }
      }
    }

    // Start polling
    await this.checkStatus(serverId);
    setInterval(() => this.checkStatus(serverId), 5000);

    // Initialize icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  static async checkStatus(serverId) {
    const data = await ServerModel.getStatus(serverId);
    if (data && data.status) {
      this.updateHeaderUI(serverId, data);
      
      // Dispatch event for page-specific logic
      document.dispatchEvent(new CustomEvent('serverStatusUpdate', { detail: data }));
    }
  }

  static updateHeaderUI(serverId, statusObj) {
    const currentStatus = statusObj.status;
    const badge = DOM.get('status-badge');
    const text = DOM.get('status-text');
    
    if (badge && text) {
      badge.className = 'status-badge';
      if (currentStatus === 'ONLINE') badge.classList.add('online');
      else if (currentStatus === 'STARTING') badge.classList.add('starting');
      else badge.classList.add('offline');
      
      text.textContent = currentStatus;
    }

    // IP / Tunnel address
    const ipEl = DOM.get('info-ip');
    if (ipEl) {
      const savedTunnel = localStorage.getItem(`tunnel_${serverId}`) || '';
      const displayIP = savedTunnel || (statusObj.ip && statusObj.port ? `${statusObj.ip}:${statusObj.port}` : '--');
      ipEl.textContent = displayIP;
    }

    // World exists indicator
    this.updateWorldExistsUI(statusObj.worldExists);

    // World time indicator
    this.updateWorldTimeUI(statusObj.worldTime);
  }

  static setAvatar(url) {
    const img = DOM.get('server-avatar-img');
    const placeholder = DOM.get('server-avatar-placeholder');
    if (img && placeholder) {
      img.src = url;
      img.style.display = 'block';
      placeholder.style.display = 'none';
    }
  }

  static setAccentColor(color) {
    document.documentElement.style.setProperty('--server-accent', color);
    // Aplicar al header y badges
    const header = DOM.get('server-header');
    if (header) header.style.borderColor = color;
  }

  static updateWorldExistsUI(exists) {
    const badge = document.getElementById('world-exists-badge');
    const worldStatus = document.getElementById('info-world-status');
    if (!badge) return;
    if (exists === undefined || exists === null) {
      badge.style.display = 'none';
      if (worldStatus) worldStatus.textContent = '--';
      return;
    }
    badge.style.display = 'flex';
    badge.className = `world-exists-badge ${exists ? 'world-exists-yes' : 'world-exists-no'}`;
    const icon = document.getElementById('world-exists-icon');
    const label = document.getElementById('world-exists-label');
    if (icon) icon.textContent = exists ? '🌍' : '📦';
    if (label) label.textContent = exists ? 'Mundo generado' : 'Sin mundo aún';
    if (worldStatus) worldStatus.textContent = exists ? '✅ Generado' : '⏳ Pendiente';
  }

  static updateWorldTimeUI(worldTime) {
    const indicator = DOM.get('world-time-indicator');
    if (!indicator) return;
    
    if (worldTime === null || worldTime === undefined) {
      indicator.style.display = 'none';
      return;
    }
    indicator.style.display = 'flex';
    
    const day = worldTime >= 0 && worldTime < 13000;
    
    // Offset by 6000 ticks (6:00 AM start)
    const totalMinutes = Math.floor(((worldTime + 6000) % 24000) / 24000 * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    
    const iconWrap = DOM.get('time-icon-wrap');
    const icon = DOM.get('time-icon');
    const label = DOM.get('time-label');
    const val = DOM.get('time-value');
    
    if (icon) icon.textContent = day ? '☀️' : '🌙';
    if (label) label.textContent = day ? 'Día' : 'Noche';
    if (val) val.textContent = timeStr;
    
    if (iconWrap) iconWrap.className = 'time-icon-wrap ' + (day ? 'time-day' : 'time-night');
    indicator.className = 'world-time-badge ' + (day ? 'time-badge-day' : 'time-badge-night');
  }
}
