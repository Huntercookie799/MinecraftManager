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

// ─── MOTD preview (colores de Minecraft) ────────────────────────────────
const MC_COLORS = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
  'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
};

function renderMotdPreview() {
  const preview = DOM.get('motd-preview');
  if (!preview) return;
  const raw = (DOM.get('edit-server-motd')?.value || '').replace(/\r?\n/g, '\n').replace(/\\n/g, '\n');
  preview.innerHTML = '';
  let state = { color: null, bold: false, italic: false, underline: false, strike: false };
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const span = document.createElement('span');
    span.textContent = buf;
    if (state.color) span.className = 'mc-color-' + state.color;
    if (state.bold) span.classList.add('mc-bold');
    if (state.italic) span.classList.add('mc-italic');
    if (state.underline) span.classList.add('mc-underline');
    if (state.strike) span.classList.add('mc-strike');
    preview.appendChild(span);
    buf = '';
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '§' && i + 1 < raw.length) {
      const code = raw[i + 1].toLowerCase();
      i++;
      if (MC_COLORS[code]) { flush(); state.color = code; }
      else if (code === 'l') { flush(); state.bold = true; }
      else if (code === 'o') { flush(); state.italic = true; }
      else if (code === 'n') { flush(); state.underline = true; }
      else if (code === 'm') { flush(); state.strike = true; }
      else if (code === 'r') { flush(); state = { color: null, bold: false, italic: false, underline: false, strike: false }; }
      else buf += ch + raw[i];
    } else {
      buf += ch;
    }
  }
  flush();
  if (!preview.innerHTML) {
    preview.innerHTML = '<span style="color: var(--text-dim);">Vista previa del MOTD...</span>';
  }
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
  let removeIconFlag = false;

  // Tabs del modal de personalización
  const switchEditTab = (name) => {
    document.querySelectorAll('.edit-tab').forEach(t => t.classList.toggle('active', t.dataset.editTab === name));
    document.querySelectorAll('.edit-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.editPanel === name));
  };
  document.querySelectorAll('.edit-tab').forEach(tab => {
    tab.addEventListener('click', () => switchEditTab(tab.dataset.editTab));
  });

  DOM.on('btn-edit-server', 'click', async () => {
    switchEditTab('general');
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

    // MOTD + icono MC: obtener datos actuales del servidor
    removeIconFlag = false;
    try {
      const res = await fetch('/api/server/', { headers: { 'Authorization': 'Bearer ' + API.token } });
      const data = await res.json();
      const s = (data.servers || []).find(x => String(x.id) === String(serverId));
      if (s) {
        const motdEl = DOM.get('edit-server-motd');
        if (motdEl) { motdEl.value = s.motd || ''; renderMotdPreview(); }
        const iconImg = DOM.get('edit-icon-preview-img');
        const removeBtn = DOM.get('btn-remove-icon');
        if (s.mcIcon) {
          iconImg.src = s.mcIcon;
          iconImg.style.display = 'block';
          removeBtn.style.display = 'inline-flex';
        } else {
          iconImg.style.display = 'none';
          removeBtn.style.display = 'none';
        }
      }
    } catch {}
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

  // Icono MC
  DOM.on('btn-edit-icon', 'click', () => DOM.get('edit-server-icon').click());
  DOM.on('edit-server-icon', 'change', () => {
    const file = DOM.get('edit-server-icon').files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = DOM.get('edit-icon-preview-img');
        img.src = e.target.result;
        img.style.display = 'block';
        DOM.get('btn-remove-icon').style.display = 'inline-flex';
      };
      reader.readAsDataURL(file);
    }
  });
  DOM.on('btn-remove-icon', 'click', () => {
    removeIconFlag = true;
    const img = DOM.get('edit-icon-preview-img');
    img.style.display = 'none';
    DOM.get('btn-remove-icon').style.display = 'none';
    DOM.get('edit-server-icon').value = '';
  });

  // MOTD
  DOM.on('edit-server-motd', 'input', renderMotdPreview);

  DOM.on('btn-save-server-settings', 'click', async () => {
    UIProgress.show('Guardando...');
    const name = DOM.get('edit-server-name').value.trim();
    const color = DOM.get('edit-server-color').value;
    const motd = DOM.get('edit-server-motd').value;
    const avatarFile = DOM.get('edit-server-avatar').files[0];
    const iconFile = DOM.get('edit-server-icon').files[0];
    
    // Build form data if there's any file, else JSON
    let response;
    if (avatarFile || iconFile || removeIconFlag) {
      const formData = new FormData();
      if (name) formData.append('name', name);
      formData.append('accentColor', color);
      formData.append('motd', motd);
      if (avatarFile) formData.append('avatar', avatarFile);
      if (iconFile) formData.append('icon', iconFile);
      if (removeIconFlag) formData.append('removeIcon', '1');
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
        body: JSON.stringify({ name, accentColor: color, motd })
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

  // ─── Exposición 80/443 (forwarder TCP) ────────────────────────────────────
  const forwardSelect = DOM.get('forward-port-select');
  const forwardCustom = DOM.get('forward-port-custom');
  const btnForwardStart = DOM.get('btn-forward-start');
  const btnForwardStop = DOM.get('btn-forward-stop');

  // Almacenar el estado actual del forwarder (lo carga ServerHeader con /forward)
  let forwardState = { active: false, publicPort: null, targetPort: null, configuredPort: null };
  const setForwardState = (s) => {
    forwardState = { ...forwardState, ...s };
    const statusEl = DOM.get('forward-status');
    const urlEl = DOM.get('forward-url');
    const targetEl = DOM.get('forward-target');
    if (forwardState.active && forwardState.publicPort) {
      statusEl.textContent = 'ACTIVO';
      statusEl.className = 'forward-status forward-active';
      btnForwardStart.setAttribute('disabled', 'true');
      btnForwardStop.removeAttribute('disabled');
      const url = `${window.location.hostname}:${forwardState.publicPort}`;
      urlEl.style.display = 'block';
      urlEl.innerHTML = `🔗 Jugadores entran por: <code>${url}</code> <button id="btn-copy-forward" class="btn-copy-ip" title="Copiar"><i data-lucide="copy" style="width:12px;height:12px;"></i> Copiar</button>`;
      if (window.lucide) lucide.createIcons();
      DOM.on('btn-copy-forward', 'click', async () => {
        try {
          await navigator.clipboard.writeText(url);
          const b = DOM.get('btn-copy-forward');
          b.innerHTML = '✓';
          setTimeout(() => { b.innerHTML = '<i data-lucide="copy" style="width:12px;height:12px;"></i> Copiar'; if (window.lucide) lucide.createIcons(); }, 1500);
        } catch {}
      });
    } else {
      statusEl.textContent = forwardState.configuredPort ? `Configurado (puerto ${forwardState.configuredPort})` : 'Inactivo';
      statusEl.className = 'forward-status';
      btnForwardStart.removeAttribute('disabled');
      btnForwardStop.setAttribute('disabled', 'true');
      urlEl.style.display = 'none';
      if (forwardState.configuredPort) {
        forwardSelect.value = String(forwardState.configuredPort) === '80' || String(forwardState.configuredPort) === '443' ? String(forwardState.configuredPort) : 'custom';
        if (String(forwardState.configuredPort) !== '80' && String(forwardState.configuredPort) !== '443') {
          forwardCustom.style.display = 'inline-block';
          forwardCustom.value = String(forwardState.configuredPort);
        }
      }
    }
    if (targetEl) targetEl.textContent = `127.0.0.1:${forwardState.targetPort ?? '--'}`;
  };

  // Cargar estado inicial del forwarder
  try {
    const res = await fetch(`/api/server/${serverId}/forward`, { headers: { 'Authorization': 'Bearer ' + API.token } });
    if (res.ok) setForwardState(await res.json());
  } catch {}

  // Refrescar el estado del forwarder junto con el polling del header
  document.addEventListener('serverStatusUpdate', () => {
    if (!forwardState.active) {
      fetch(`/api/server/${serverId}/forward`, { headers: { 'Authorization': 'Bearer ' + API.token } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setForwardState(d); })
        .catch(() => {});
    }
  });

  DOM.on(forwardSelect, 'change', () => {
    forwardCustom.style.display = forwardSelect.value === 'custom' ? 'inline-block' : 'none';
  });

  DOM.on(btnForwardStart, 'click', async () => {
    let publicPort;
    if (forwardSelect.value === 'custom') {
      publicPort = parseInt(forwardCustom.value, 10);
    } else {
      publicPort = parseInt(forwardSelect.value, 10);
    }
    if (!publicPort || publicPort < 1 || publicPort > 65535) {
      alert('Ingresá un puerto válido (1-65535)');
      return;
    }
    UIProgress.show('Exponiendo puerto...');
    try {
      const res = await fetch(`/api/server/${serverId}/forward`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicPort })
      });
      const data = await res.json();
      if (res.ok) {
        setForwardState({ active: true, publicPort: data.publicPort, targetPort: data.targetPort, configuredPort: publicPort });
      } else {
        alert(data.error || 'Error al exponer el puerto');
      }
    } catch (e) {
      alert('Error de red al exponer el puerto');
    } finally {
      UIProgress.hide();
    }
  });

  DOM.on(btnForwardStop, 'click', async () => {
    UIProgress.show('Deteniendo exposición...');
    try {
      const res = await fetch(`/api/server/${serverId}/forward`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + API.token }
      });
      if (res.ok) {
        setForwardState({ active: false, publicPort: null, configuredPort: null });
      } else {
        const data = await res.json();
        alert(data.error || 'Error al detener la exposición');
      }
    } catch {
      alert('Error de red al detener la exposición');
    } finally {
      UIProgress.hide();
    }
  });
});
