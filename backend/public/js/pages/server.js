import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';
import { WorldModel } from '../models/World.js';
import '../components/UIButton.js';
import { UIProgress } from '../components/UIProgress.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Format seconds into HH:MM:SS or Xh Xm Xs
 */
function formatPlaytime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

/**
 * Convert Minecraft daytime ticks (0-24000) to a human-readable time string.
 * In Minecraft: 0 = 06:00, 6000 = 12:00, 12000 = 18:00, 18000 = 00:00
 */
function ticksToTime(ticks) {
  // Offset by 6000 ticks (6:00 AM start)
  const totalMinutes = Math.floor(((ticks + 6000) % 24000) / 24000 * 24 * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Return true if it's daytime in Minecraft (0-12999)
 */
function isDay(ticks) {
  return ticks >= 0 && ticks < 13000;
}

/**
 * Get dimension display config
 */
function getDimensionConfig(dim) {
  switch (dim) {
    case 'overworld': return { label: 'Overworld', emoji: '🌳', cls: 'dim-overworld' };
    case 'nether':    return { label: 'Nether',    emoji: '🔥', cls: 'dim-nether' };
    case 'end':       return { label: 'The End',   emoji: '🌌', cls: 'dim-end' };
    default:          return { label: 'Desconocido', emoji: '❓', cls: 'dim-unknown' };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
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

  // UI Elements
  const terminalOutput = DOM.get('terminal-output');
  const commandInput = DOM.get('command-input');
  const btnSendCommand = DOM.get('btn-send-command');
  
  const btnStart = DOM.get('btn-start');
  const btnRestart = DOM.get('btn-restart');
  const btnStop = DOM.get('btn-stop');
  const btnDelete = DOM.get('btn-delete-server');
  
  let currentStatus = 'OFFLINE';
  let pollInterval = null;
  let currentWs = null;

  // ─── Tabs ──────────────────────────────────────────────────────────────────

  DOM.on('tab-server', 'click', (e) => {
    e.preventDefault();
    setActiveTab('server');
  });

  DOM.on('tab-worlds', 'click', (e) => {
    e.preventDefault();
    setActiveTab('worlds');
    loadWorlds();
  });

  DOM.on('tab-files', 'click', (e) => {
    e.preventDefault();
    setActiveTab('files');
    loadFiles('.');
  });

  function setActiveTab(tab) {
    ['server', 'worlds', 'files'].forEach(t => {
      const tabEl = DOM.get(`tab-${t}`);
      const viewEl = DOM.get(`view-${t}`);
      if (tabEl) tabEl.classList.toggle('active', t === tab);
      if (viewEl) viewEl.classList.toggle('active', t === tab);
    });
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  DOM.on(btnStart, 'click', async () => {
    UIProgress.show('Iniciando...');
    await ServerModel.start(serverId);
    UIProgress.hide();
  });
  DOM.on(btnStop, 'click', async () => {
    UIProgress.show('Deteniendo...');
    await ServerModel.stop(serverId);
    UIProgress.hide();
  });
  DOM.on(btnRestart, 'click', async () => {
    UIProgress.show('Reiniciando...');
    await ServerModel.restart(serverId);
    UIProgress.hide();
  });
  
  DOM.on(btnDelete, 'click', async () => {
    if (confirm('¿Estás seguro de que quieres eliminar este servidor y TODOS sus archivos?')) {
      await ServerModel.delete(serverId);
      window.location.href = '/dashboard.html';
    }
  });

  DOM.on(btnSendCommand, 'click', sendCommand);
  DOM.on(commandInput, 'keypress', (e) => {
    if (e.key === 'Enter') sendCommand();
  });

  async function sendCommand() {
    const cmd = commandInput.value.trim();
    if (!cmd) return;
    await ServerModel.sendCommand(serverId, cmd);
    commandInput.value = '';
  }

  // ─── Status polling ────────────────────────────────────────────────────────

  async function checkStatus() {
    const data = await ServerModel.getStatus(serverId);
    if (data && data.status) {
      updateUIStatus(data);
    }
  }

  // ─── UI Update ─────────────────────────────────────────────────────────────

  function updateUIStatus(statusObj) {
    currentStatus = statusObj.status;
    const badge = DOM.get('status-badge');
    const text = DOM.get('status-text');
    
    badge.className = 'status-badge';
    if (currentStatus === 'ONLINE') {
      badge.classList.add('online');
      btnStart.setAttribute('disabled', 'true');
      btnStop.removeAttribute('disabled');
      btnRestart.removeAttribute('disabled');
      commandInput.removeAttribute('disabled');
      btnSendCommand.removeAttribute('disabled');
      DOM.get('starting-progress-container').classList.remove('active');
    } else if (currentStatus === 'STARTING') {
      badge.classList.add('starting');
      btnStart.setAttribute('disabled', 'true');
      btnStop.removeAttribute('disabled');
      btnRestart.removeAttribute('disabled');
      commandInput.setAttribute('disabled', 'true');
      btnSendCommand.setAttribute('disabled', 'true');
      DOM.get('starting-progress-container').classList.add('active');
    } else {
      badge.classList.add('offline');
      btnStart.removeAttribute('disabled');
      btnStop.setAttribute('disabled', 'true');
      btnRestart.setAttribute('disabled', 'true');
      commandInput.setAttribute('disabled', 'true');
      btnSendCommand.setAttribute('disabled', 'true');
      DOM.get('starting-progress-container').classList.remove('active');
    }
    
    text.textContent = currentStatus;

    // Basic info
    DOM.get('info-players').textContent = `${statusObj.players}/${statusObj.maxPlayers}`;
    DOM.get('info-uptime').textContent = formatUptime(statusObj.uptime);
    if (statusObj.version) DOM.get('info-version').textContent = statusObj.version;

    // IP / Tunnel address
    const tunnelInput = document.getElementById('tunnel-addr-input');
    const savedTunnel = localStorage.getItem(`tunnel_${serverId}`) || '';
    const displayIP = savedTunnel || (statusObj.ip && statusObj.port ? `${statusObj.ip}:${statusObj.port}` : '--');
    DOM.get('info-ip').textContent = displayIP;

    // Show Render TCP banner if hostname includes 'onrender.com' and no tunnel saved
    const renderBanner = document.getElementById('render-tcp-banner');
    const isRender = window.location.hostname.includes('onrender.com') || (statusObj.ip && statusObj.ip.includes('onrender.com'));
    if (renderBanner) {
      renderBanner.style.display = isRender ? 'flex' : 'none';
      if (tunnelInput && !tunnelInput._listenerAdded) {
        tunnelInput._listenerAdded = true;
        tunnelInput.value = savedTunnel;
        tunnelInput.addEventListener('change', () => {
          const val = tunnelInput.value.trim();
          if (val) {
            localStorage.setItem(`tunnel_${serverId}`, val);
          } else {
            localStorage.removeItem(`tunnel_${serverId}`);
          }
          DOM.get('info-ip').textContent = val || `${statusObj.ip}:${statusObj.port}`;
        });
      }
    }

    // World exists indicator
    updateWorldExistsUI(statusObj.worldExists);

    // World time indicator
    updateWorldTimeUI(statusObj.worldTime);

    // Players list
    updatePlayersUI(statusObj.playersInfo ?? []);
  }

  function formatUptime(seconds) {
    if (!seconds || seconds === 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function updateWorldExistsUI(exists) {
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
    document.getElementById('world-exists-icon').textContent = exists ? '🌍' : '📦';
    document.getElementById('world-exists-label').textContent = exists ? 'Mundo generado' : 'Sin mundo aún';
    if (worldStatus) worldStatus.textContent = exists ? '✅ Generado' : '⏳ Pendiente';
  }

  function updateWorldTimeUI(worldTime) {
    const indicator = DOM.get('world-time-indicator');
    if (worldTime === null || worldTime === undefined) {
      indicator.style.display = 'none';
      return;
    }
    indicator.style.display = 'flex';
    
    const day = isDay(worldTime);
    const timeStr = ticksToTime(worldTime);
    const iconWrap = DOM.get('time-icon-wrap');
    
    DOM.get('time-icon').textContent = day ? '☀️' : '🌙';
    DOM.get('time-label').textContent = day ? 'Día' : 'Noche';
    DOM.get('time-value').textContent = timeStr;
    
    iconWrap.className = 'time-icon-wrap ' + (day ? 'time-day' : 'time-night');
    indicator.className = 'world-time-badge ' + (day ? 'time-badge-day' : 'time-badge-night');
  }

  function updatePlayersUI(playersInfo) {
    const list = DOM.get('players-list');
    const empty = DOM.get('players-empty');
    const countBadge = DOM.get('players-count-badge');
    
    const onlinePlayers = playersInfo.filter(p => p.online);
    countBadge.textContent = onlinePlayers.length;

    if (onlinePlayers.length === 0) {
      empty.style.display = 'flex';
      // Remove all player rows
      list.querySelectorAll('.player-row').forEach(el => el.remove());
      return;
    }

    empty.style.display = 'none';

    // Build set of current names
    const currentNames = new Set(onlinePlayers.map(p => p.name));

    // Remove rows for players no longer online
    list.querySelectorAll('.player-row').forEach(el => {
      if (!currentNames.has(el.dataset.name)) el.remove();
    });

    // Add / update rows
    onlinePlayers.forEach(player => {
      const existing = list.querySelector(`.player-row[data-name="${player.name}"]`);
      const dimCfg = getDimensionConfig(player.dimension);
      const coords = (player.x !== null && player.y !== null && player.z !== null)
        ? `${player.x}, ${player.y}, ${player.z}`
        : 'Desconocido';
      const playtime = formatPlaytime(player.playtimeSeconds);
      const skinUrl = `https://mc-heads.net/avatar/${player.name}/40`;

      if (existing) {
        // Update dynamic fields
        const dimEl = existing.querySelector('.player-dim');
        if (dimEl) {
          dimEl.className = `player-dim ${dimCfg.cls}`;
          dimEl.innerHTML = `<span>${dimCfg.emoji}</span> ${dimCfg.label}`;
        }
        const coordEl = existing.querySelector('.player-coords');
        if (coordEl) coordEl.textContent = coords;
        const playtimeEl = existing.querySelector('.player-playtime');
        if (playtimeEl) playtimeEl.textContent = `⏱ ${playtime}`;
      } else {
        const row = document.createElement('div');
        row.className = 'player-row';
        row.dataset.name = player.name;
        row.innerHTML = `
          <div class="player-avatar">
            <img src="${skinUrl}" alt="${player.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><rect width=%2240%22 height=%2240%22 fill=%22%23475569%22 rx=%228%22/><text x=%2250%25%22 y=%2255%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2218%22>👤</text></svg>'">
            <span class="player-online-dot"></span>
          </div>
          <div class="player-info">
            <span class="player-name">${player.name}</span>
            <span class="player-coords">📍 ${coords}</span>
          </div>
          <div class="player-meta">
            <span class="player-dim ${dimCfg.cls}"><span>${dimCfg.emoji}</span> ${dimCfg.label}</span>
            <span class="player-playtime">⏱ ${playtime}</span>
          </div>
        `;
        list.appendChild(row);
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // ─── WebSocket ─────────────────────────────────────────────────────────────

  let wsReconnectDelay = 2000; // Empieza en 2s, crece con backoff
  let wsKeepaliveTimer = null;

  function connectWebSocket() {
    if (currentWs) currentWs.close();
    if (wsKeepaliveTimer) clearInterval(wsKeepaliveTimer);
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // El backend registra el WS en /ws/logs con serverId como query param
    const wsUrl = `${protocol}//${window.location.host}/ws/logs?serverId=${serverId}&token=${API.token}`;
    currentWs = new WebSocket(wsUrl);

    currentWs.onopen = () => {
      // Resetear delay de reconexión al conectar exitosamente
      wsReconnectDelay = 2000;
      setWsStatus(true);
      // Keepalive: ping cada 25s para prevenir timeout de 60s de Render
      wsKeepaliveTimer = setInterval(() => {
        if (currentWs && currentWs.readyState === WebSocket.OPEN) {
          currentWs.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25_000);
    };

    currentWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          const line = data.log ?? data.content;
          if (line) appendLog(typeof line === 'object' ? line.message : line);
        } else if (data.type === 'snapshot') {
          if (Array.isArray(data.logs)) {
            data.logs.forEach((ln) => appendLog(typeof ln === 'object' ? ln.message : ln));
          }
        } else if (data.type === 'status') {
          updateUIStatus(data.data);
        }
      } catch (e) {
        // ignore malformed messages
      }
    };

    currentWs.onclose = () => {
      if (wsKeepaliveTimer) { clearInterval(wsKeepaliveTimer); wsKeepaliveTimer = null; }
      setWsStatus(false);
      // Reconexión con backoff exponencial (máx 30s)
      setTimeout(connectWebSocket, wsReconnectDelay);
      wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 30_000);
    };
  }

  function appendLog(line) {
    if (!line) return;
    const div = DOM.create('div', 'terminal-line');
    
    if (line.includes('WARN')) div.classList.add('warn');
    else if (line.includes('ERROR') || line.includes('Exception')) div.classList.add('error');
    else if (line.includes('INFO')) div.classList.add('info');
    
    div.textContent = line;
    terminalOutput.appendChild(div);
    if (terminalOutput.childNodes.length > 500) {
      terminalOutput.removeChild(terminalOutput.firstChild);
    }
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  function setWsStatus(connected) {
    const dot = document.getElementById('ws-status-dot');
    const label = document.getElementById('ws-status-label');
    if (!dot || !label) return;
    if (connected) {
      dot.className = 'ws-dot ws-dot-on';
      label.textContent = 'En vivo';
    } else {
      dot.className = 'ws-dot ws-dot-off';
      label.textContent = 'Reconectando...';
    }
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    const all = await ServerModel.getAll();
    const server = all.find(s => s.id == serverId);
    if (server) {
      DOM.get('current-server-name').textContent = server.name;
      DOM.get('current-server-info').textContent = `Puerto: ${server.port} | RAM: ${server.memory}`;
    }

    await checkStatus();
    pollInterval = setInterval(checkStatus, 5000);
    connectWebSocket();
    
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // ─── Worlds Logic ──────────────────────────────────────────────────────────

  const modalWorld = DOM.get('new-world-modal');
  DOM.on('btn-show-new-world', 'click', () => DOM.show(modalWorld));
  DOM.on('btn-cancel-new-world', 'click', () => DOM.hide(modalWorld));
  
  DOM.on('btn-create-world', 'click', async () => {
    const name = DOM.get('new-world-name').value;
    await WorldModel.create(serverId, name);
    DOM.hide(modalWorld);
    loadWorlds();
  });

  async function loadWorlds() {
    const list = DOM.get('worlds-list');
    list.innerHTML = '<p>Cargando mundos...</p>';
    
    const worlds = await WorldModel.getAll(serverId);
    list.innerHTML = '';

    if (!worlds || worlds.length === 0) {
      list.innerHTML = '<p>No se encontraron mundos.</p>';
      return;
    }

    worlds.forEach(w => {
      const isLoaded = w.isLoaded;
      const isActive = w.isActive;
      
      const card = DOM.create('div', 'world-card');
      card.innerHTML = `
        <div class="world-thumbnail">
          ${isActive ? '<span class="world-badge">Activo</span>' : ''}
        </div>
        <div class="world-info">
          <h4>${w.name}</h4>
          <p>Carpeta: ${w.folder}</p>
          <p>Estado: ${isLoaded ? 'Cargado' : 'Descargado'}</p>
          <p>Tamaño: ${(w.sizeBytes / 1024 / 1024).toFixed(2)} MB</p>
        </div>
        <div class="world-actions">
          <ui-button variant="blue" class="btn-load-world" data-world="${w.name}" ${isLoaded ? 'disabled' : ''}><i data-lucide="upload-cloud"></i> Cargar</ui-button>
          <ui-button variant="danger" class="btn-delete-world" data-world="${w.name}" ${isActive ? 'disabled' : ''}><i data-lucide="trash-2"></i> Borrar</ui-button>
        </div>
      `;
      list.appendChild(card);
    });

    DOM.on('.btn-load-world', 'click', async (e) => {
      const worldName = e.target.closest('ui-button').getAttribute('data-world');
      await WorldModel.load(serverId, worldName);
      loadWorlds();
    });

    DOM.on('.btn-delete-world', 'click', async (e) => {
      const worldName = e.target.closest('ui-button').getAttribute('data-world');
      if (confirm('¿Borrar mundo ' + worldName + '?')) {
        await WorldModel.delete(serverId, worldName);
        loadWorlds();
      }
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // ─── Files Logic ───────────────────────────────────────────────────────────

  const FILE_ICONS = {
    // Configuración
    '.yml': '⚙️', '.yaml': '⚙️', '.json': '⚙️', '.properties': '⚙️', '.toml': '⚙️',
    // Logs
    '.log': '📋', '.txt': '📄',
    // Minecraft
    '.jar': '☕', '.zip': '📦', '.gz': '📦', '.tar': '📦',
    // Datos
    '.dat': '💾', '.dat_old': '💾', '.mca': '🗺️', '.mcaspec': '🗺️',
    // Scripts
    '.sh': '⚡', '.bat': '⚡', '.cmd': '⚡',
    // Imágenes
    '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️',
    // Otros
    'default': '📄'
  };

  const FOLDER_ICONS = {
    'world': '🌍', 'world_nether': '🔥', 'world_the_end': '🌌',
    'plugins': '🔌', 'logs': '📋', 'cache': '💿', 'config': '⚙️',
    'default': '📁'
  };

  function getFileIcon(name, type, ext) {
    if (type === 'dir') return FOLDER_ICONS[name] || FOLDER_ICONS['default'];
    return FILE_ICONS[ext] || FILE_ICONS['default'];
  }

  async function loadFiles(dirPath) {
    const filesList = DOM.get('files-list');
    const breadcrumb = DOM.get('files-breadcrumb');
    if (!filesList) return;

    filesList.innerHTML = `
      <div class="files-loading">
        <div class="files-spinner"></div>
        <p>Cargando archivos...</p>
      </div>`;

    const data = await API.call(`/${serverId}/files?path=${encodeURIComponent(dirPath)}`, 'GET', null, '/api/server', true);

    if (!data) {
      filesList.innerHTML = `<div class="files-empty"><span>❌</span><p>No se pudo cargar los archivos.</p></div>`;
      return;
    }

    if (!data.serverExists) {
      filesList.innerHTML = `
        <div class="files-empty">
          <span>📦</span>
          <p>El servidor aún no tiene archivos en disco.</p>
          <small>Inícialo al menos una vez para que se generen los archivos.</small>
        </div>`;
      return;
    }

    // Update breadcrumb
    if (breadcrumb) {
      const parts = data.currentPath === '.' ? [] : data.currentPath.split('/');
      let html = `<span class="breadcrumb-item breadcrumb-root" data-path="." style="cursor:pointer;">📁 Raíz</span>`;
      let accumulated = '';
      parts.forEach((p, i) => {
        accumulated = accumulated ? `${accumulated}/${p}` : p;
        const isLast = i === parts.length - 1;
        const pathSnap = accumulated;
        html += `<span class="breadcrumb-sep">/</span>`;
        html += `<span class="breadcrumb-item ${isLast ? 'breadcrumb-current' : ''}" data-path="${pathSnap}" style="cursor:${isLast ? 'default' : 'pointer'};">${p}</span>`;
      });
      breadcrumb.innerHTML = html;
      breadcrumb.querySelectorAll('.breadcrumb-item:not(.breadcrumb-current)').forEach(el => {
        el.addEventListener('click', () => loadFiles(el.dataset.path));
      });
    }

    if (data.items.length === 0) {
      filesList.innerHTML = `<div class="files-empty"><span>📂</span><p>Carpeta vacía</p></div>`;
      return;
    }

    const rows = [];

    // Back button
    if (data.parentPath !== null) {
      rows.push(`
        <div class="file-row file-row-back" data-path="${data.parentPath}">
          <span class="file-icon">⬆️</span>
          <span class="file-name">..</span>
          <span class="file-size"></span>
          <span class="file-date"></span>
        </div>`);
    }

    data.items.forEach(item => {
      const icon = getFileIcon(item.name, item.type, item.extension || '');
      const isDir = item.type === 'dir';
      const date = item.modified ? new Date(item.modified).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      rows.push(`
        <div class="file-row ${isDir ? 'file-row-dir' : 'file-row-file'}" 
             data-path="${item.path}" 
             data-type="${item.type}"
             title="${item.name}">
          <span class="file-icon">${icon}</span>
          <span class="file-name">${item.name}</span>
          <span class="file-size">${item.sizeFormatted || ''}</span>
          <span class="file-date">${date}</span>
        </div>`);
    });

    filesList.innerHTML = rows.join('');

    // Click: navegar en carpetas
    filesList.querySelectorAll('.file-row[data-type="dir"], .file-row-back').forEach(el => {
      el.addEventListener('click', () => loadFiles(el.dataset.path));
    });
  }

  init();
});

