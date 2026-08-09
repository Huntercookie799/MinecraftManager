import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';
import '../components/index.js';
import { ServerHeader } from './server-header.js';

// ─── Main ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await ServerHeader.init();

  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) return;

  const terminalOutput = DOM.get('terminal-output');
  const commandInput = DOM.get('command-input');
  const btnSendCommand = DOM.get('btn-send-command');
  
  // UI Toggles
  const btnLive = DOM.get('btn-console-live');
  const btnHistory = DOM.get('btn-console-history');
  const terminalContainer = DOM.get('terminal-container');
  const historyContainer = DOM.get('history-container');
  
  // History State
  let historyPage = 1;
  let historyLimit = 100;
  
  let currentWs = null;

  // ─── Events from Header ────────────────────────────────────────────────────

  document.addEventListener('serverStatusUpdate', (e) => {
    const statusObj = e.detail;
    const currentStatus = statusObj.status;

    if (currentStatus === 'ONLINE') {
      commandInput.removeAttribute('disabled');
      btnSendCommand.removeAttribute('disabled');
    } else {
      commandInput.setAttribute('disabled', 'true');
      btnSendCommand.setAttribute('disabled', 'true');
    }
  });

  // ─── Commands ──────────────────────────────────────────────────────────────
  
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
  
  // ─── UI Toggles & History ──────────────────────────────────────────────────
  
  DOM.on(btnLive, 'click', () => {
    btnLive.setAttribute('active', '');
    btnHistory.removeAttribute('active');

    terminalContainer.style.display = 'block';
    historyContainer.style.display = 'none';
  });

  DOM.on(btnHistory, 'click', () => {
    btnHistory.setAttribute('active', '');
    btnLive.removeAttribute('active');

    terminalContainer.style.display = 'none';
    historyContainer.style.display = 'block';

    loadHistory(1);
  });

  async function loadHistory(page) {
    historyPage = page;
    const tableWrapper = DOM.get('history-table-wrapper');
    const loading = DOM.get('history-loading');
    const prevBtn = DOM.get('btn-history-prev');
    const nextBtn = DOM.get('btn-history-next');
    const pageInfo = DOM.get('history-page-info');
    
    if (loading) loading.style.display = 'block';
    if (tableWrapper) tableWrapper.style.display = 'none';
    prevBtn.setAttribute('disabled', 'true');
    nextBtn.setAttribute('disabled', 'true');

    const data = await API.call(`/${serverId}/logs/history?page=${page}&limit=${historyLimit}`, 'GET', null, '/api/server', true);
    
    if (loading) loading.style.display = 'none';
    if (tableWrapper) tableWrapper.style.display = 'block';

    if (!data || !data.logs || data.logs.length === 0) {
      tableWrapper.innerHTML = `
        <div class="terminal" style="min-height: 200px; display: flex; align-items: center; justify-content: center;">
          <div class="terminal-line info" style="opacity: 0.5; text-align: center;">> No hay historial de logs en la base de datos para este servidor.</div>
        </div>
      `;
      pageInfo.textContent = `Página 1 / 1`;
      return;
    }

    // Build Table
    const rows = [];
    rows.push(`
      <table class="r2-table">
        <thead>
          <tr>
            <th style="width: 150px;">Fecha</th>
            <th style="width: 80px;">Nivel</th>
            <th>Mensaje</th>
          </tr>
        </thead>
        <tbody>
    `);

    data.logs.forEach(log => {
      const date = new Date(log.createdAt).toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      let levelColor = 'var(--text-dim)';
      if (log.level === 'WARN') levelColor = 'var(--color-warning)';
      if (log.level === 'ERROR') levelColor = 'var(--color-danger)';
      if (log.level === 'INFO') levelColor = 'var(--color-info)';

      rows.push(`
          <tr>
            <td style="color: var(--text-dim); white-space: nowrap;">${date}</td>
            <td style="color: ${levelColor}; font-weight: bold;">${log.level}</td>
            <td style="font-family: var(--font-mono); font-size: 0.85rem; color: #bbb;">${DOM.escape(log.message)}</td>
          </tr>
      `);
    });

    rows.push(`
        </tbody>
      </table>
    `);

    tableWrapper.innerHTML = rows.join('');
    
    // Pagination logic
    pageInfo.textContent = `Página ${data.page} / ${data.totalPages || 1}`;
    
    if (data.page > 1) {
      prevBtn.removeAttribute('disabled');
      prevBtn.onclick = () => loadHistory(data.page - 1);
    }
    
    if (data.page < data.totalPages) {
      nextBtn.removeAttribute('disabled');
      nextBtn.onclick = () => loadHistory(data.page + 1);
    }
  }

  // ─── WebSocket ─────────────────────────────────────────────────────────────

  let wsReconnectDelay = 2000;
  let wsKeepaliveTimer = null;

  function connectWebSocket() {
    if (currentWs) currentWs.close();
    if (wsKeepaliveTimer) clearInterval(wsKeepaliveTimer);
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/logs?serverId=${serverId}&token=${API.token}`;
    currentWs = new WebSocket(wsUrl);

    currentWs.onopen = () => {
      wsReconnectDelay = 2000;
      setWsStatus(true);
      
      // Añadir placeholder inicial si está vacío
      if (terminalOutput.childNodes.length === 0) {
        terminalOutput.innerHTML = `<div class="terminal-line info" style="opacity: 0.5;">> Esperando logs de la consola...</div>`;
      }
      
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
        }
      } catch (e) {
        // ignore
      }
    };

    currentWs.onclose = () => {
      if (wsKeepaliveTimer) { clearInterval(wsKeepaliveTimer); wsKeepaliveTimer = null; }
      setWsStatus(false);
      setTimeout(connectWebSocket, wsReconnectDelay);
      wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 30_000);
    };
  }

  function appendLog(line) {
    if (!line) return;
    
    // Quitar el placeholder si existe
    if (terminalOutput.childNodes.length === 1 && terminalOutput.firstChild.textContent.includes('Esperando logs')) {
      terminalOutput.innerHTML = '';
    }
    
    const div = DOM.create('div', 'terminal-line');
    if (line.includes('WARN')) div.classList.add('warn');
    else if (line.includes('ERROR') || line.includes('Exception')) div.classList.add('error');
    else if (line.includes('INFO')) div.classList.add('info');
    div.textContent = line;
    terminalOutput.appendChild(div);
    if (terminalOutput.childNodes.length > 500) terminalOutput.removeChild(terminalOutput.firstChild);
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

  connectWebSocket();
});
