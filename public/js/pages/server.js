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
      commandInput.removeAttribute('disabled');
      btnSendCommand.removeAttribute('disabled');
      DOM.get('starting-progress-container').classList.remove('active');
    } else if (currentStatus === 'STARTING') {
      btnStart.setAttribute('disabled', 'true');
      btnStop.removeAttribute('disabled');
      btnRestart.removeAttribute('disabled');
      commandInput.setAttribute('disabled', 'true');
      btnSendCommand.setAttribute('disabled', 'true');
      DOM.get('starting-progress-container').classList.add('active');
    } else {
      btnStart.removeAttribute('disabled');
      btnStop.setAttribute('disabled', 'true');
      btnRestart.setAttribute('disabled', 'true');
      commandInput.setAttribute('disabled', 'true');
      btnSendCommand.setAttribute('disabled', 'true');
      DOM.get('starting-progress-container').classList.remove('active');
    }

    DOM.get('info-players').textContent = `${statusObj.players}/${statusObj.maxPlayers}`;
    DOM.get('info-uptime').textContent = formatUptime(statusObj.uptime);
    if (statusObj.version) DOM.get('info-version').textContent = statusObj.version;
  });
});
