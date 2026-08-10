import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';
import '../components/index.js';
import { UIProgress } from '../components/UIProgress.js';
import { ServerHeader } from './server-header.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPlaytime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function getDimensionConfig(dim) {
  switch (dim) {
    case 'overworld': return { label: 'Overworld', emoji: '🌳', cls: 'dim-overworld' };
    case 'nether':    return { label: 'Nether',    emoji: '🔥', cls: 'dim-nether' };
    case 'end':       return { label: 'The End',   emoji: '🌌', cls: 'dim-end' };
    default:          return { label: 'Desconocido', emoji: '❓', cls: 'dim-unknown' };
  }
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

// ─── Main ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar Header (auth, polling, etc)
  await ServerHeader.init();

  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) return;

  // UI Elements
  const terminalOutput = DOM.get('terminal-output');
  const commandInput = DOM.get('command-input');
  const btnSendCommand = DOM.get('btn-send-command');
  
  const btnStart = DOM.get('btn-start');
  const btnRestart = DOM.get('btn-restart');
  const btnStop = DOM.get('btn-stop');
  const btnDelete = DOM.get('btn-delete-server');
  
  let currentWs = null;

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

  // ─── Personalization ───────────────────────────────────────────────────
  const editModal = DOM.get('edit-server-modal');
  
  DOM.on('btn-edit-server', 'click', () => {
    // Cargar valores actuales
    const nameEl = DOM.get('current-server-name');
    if (nameEl) DOM.get('edit-server-name').value = nameEl.textContent;
    const avatarImg = DOM.get('server-avatar-img');
    if (avatarImg && avatarImg.src) {
      const previewImg = DOM.get('edit-avatar-preview-img');
      previewImg.src = avatarImg.src;
      previewImg.style.display = 'block';
    }
    const currentColor = getComputedStyle(document.documentElement).getPropertyValue('--server-accent').trim() || '#55FF55';
    const colorInput = DOM.get('edit-server-color');
    colorInput.value = currentColor;
    DOM.get('edit-server-color-hex').textContent = currentColor;
    DOM.show(editModal);
  });
  
  DOM.on('btn-cancel-edit-server', 'click', () => DOM.hide(editModal));
  
  DOM.on('btn-edit-avatar', 'click', () => DOM.get('edit-server-avatar').click());
  
  DOM.on('edit-server-avatar', 'change', () => {
    const file = DOM.get('edit-server-avatar').files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const previewImg = DOM.get('edit-avatar-preview-img');
        previewImg.src = e.target.result;
        previewImg.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });
  
  DOM.on('edit-server-color', 'input', () => {
    const val = DOM.get('edit-server-color').value;
    DOM.get('edit-server-color-hex').textContent = val;
  });
  
  DOM.on('btn-save-server-settings', 'click', async () => {
    UIProgress.show('Guardando...');
    const name = DOM.get('edit-server-name').value.trim();
    const color = DOM.get('edit-server-color').value;
    const avatarFile = DOM.get('edit-server-avatar').files[0];
    
    // Build form data if there's an avatar, else JSON
    let response;
    if (avatarFile) {
      const formData = new FormData();
      if (name) formData.append('name', name);
      formData.append('accentColor', color);
      formData.append('avatar', avatarFile);
      response = await fetch(`/api/server/${serverId}/settings`, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + API.token },
        body: formData
      });
    } else {
      response = await fetch(`/api/server/${serverId}/settings`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + API.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, accentColor: color })
      });
    }
    
    const data = await response.json();
    UIProgress.hide();
    
    if (response.ok && data.server) {
      // Actualizar UI inmediatamente
      if (data.server.name) DOM.get('current-server-name').textContent = data.server.name;
      if (data.server.avatar) ServerHeader.setAvatar(data.server.avatar);
      if (data.server.accentColor) ServerHeader.setAccentColor(data.server.accentColor);
      DOM.hide(editModal);
    } else {
      const errMsg = data.error || 'Error al guardar';
      alert(errMsg);
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

  // ─── Events from Header ────────────────────────────────────────────────────

  document.addEventListener('serverStatusUpdate', (e) => {
    const statusObj = e.detail;
    const currentStatus = statusObj.status;

    if (currentStatus === 'ONLINE') {
      btnStart.setAttribute('disabled', 'true');
      btnStop.removeAttribute('disabled');
      btnRestart.removeAttribute('disabled');
      commandInput?.removeAttribute('disabled');
      btnSendCommand?.removeAttribute('disabled');
      DOM.get('starting-progress-container')?.classList.remove('active');
    } else if (currentStatus === 'STARTING') {
      btnStart.setAttribute('disabled', 'true');
      btnStop.removeAttribute('disabled');
      btnRestart.removeAttribute('disabled');
      commandInput?.setAttribute('disabled', 'true');
      btnSendCommand?.setAttribute('disabled', 'true');
      DOM.get('starting-progress-container')?.classList.add('active');
    } else {
      btnStart.removeAttribute('disabled');
      btnStop.setAttribute('disabled', 'true');
      btnRestart.setAttribute('disabled', 'true');
      commandInput?.setAttribute('disabled', 'true');
      btnSendCommand?.setAttribute('disabled', 'true');
      DOM.get('starting-progress-container')?.classList.remove('active');
    }

    DOM.get('info-players').textContent = `${statusObj.players}/${statusObj.maxPlayers}`;
    DOM.get('info-uptime').textContent = formatUptime(statusObj.uptime);
    if (statusObj.version) DOM.get('info-version').textContent = statusObj.version;

    // ── Estrategia de acceso 80/443 ─────────────────────────────────────
    if (statusObj.ip && statusObj.port) {
      const addr = `${statusObj.ip}:${statusObj.port}`;
      const ipEl = DOM.get('info-ip');
      if (ipEl) ipEl.textContent = addr;
      const copyBtn = DOM.get('btn-copy-ip');
      if (copyBtn) copyBtn.style.display = 'inline-flex';

      const restricted = statusObj.port === 80 || statusObj.port === 443;
      const badge = DOM.get('restricted-network-badge');
      if (badge) badge.style.display = restricted ? 'block' : 'none';
      const srvHint = DOM.get('srv-hint');
      if (srvHint) {
        srvHint.style.display = restricted ? 'block' : 'none';
        if (restricted) {
          srvHint.innerHTML = `Con un dominio, agregá el registro SRV: <code>_minecraft._tcp.tudominio.com</code> → puerto <code>${statusObj.port}</code> en <code>${statusObj.ip}</code> para que los jugadores escriban solo el dominio.`;
        }
      }
    }
  });

  // Copiar dirección de conexión
  DOM.on('btn-copy-ip', 'click', async () => {
    const addr = DOM.get('info-ip')?.textContent;
    if (!addr || addr === '--') return;
    try {
      await navigator.clipboard.writeText(addr);
      const btn = DOM.get('btn-copy-ip');
      const original = btn.innerHTML;
      btn.innerHTML = '✓ Copiado';
      setTimeout(() => { btn.innerHTML = original; }, 1500);
    } catch {
      // clipboard no disponible (p.ej. http no seguro)
    }
  });
});
