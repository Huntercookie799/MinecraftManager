import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';
import '../components/index.js';
import { ServerHeader } from './server-header.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Main ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await ServerHeader.init();

  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) return;

  const terminalOutput = DOM.get('terminal-output');
  const commandInput = DOM.get('command-input');
  const btnSendCommand = DOM.get('btn-send-command');
  
  // Elementos del spinner
  const terminalSpinner = DOM.get('terminal-spinner');
  const spinnerMessage = DOM.get('spinner-message');
  
  // UI Toggles
  const btnLive = DOM.get('btn-console-live');
  const btnHistory = DOM.get('btn-console-history');
  const terminalContainer = DOM.get('terminal-container');
  const historyContainer = DOM.get('history-container');
  const historySpinner = DOM.get('history-spinner');
  const historyTableWrapper = DOM.get('history-table-wrapper');
  
  // History State
  let historyPage = 1;
  let historyLimit = 100;
  
  let currentWs = null;
  let isFirstLoad = true;

  // ─── Control del Spinner ──────────────────────────────────────────────────
  
  function showSpinner(message = 'CARGANDO LOGS...', subMessage = 'Esperando conexión con el servidor') {
    if (terminalSpinner) {
      terminalSpinner.classList.add('active');
      if (spinnerMessage) spinnerMessage.textContent = message;
      const subText = terminalSpinner.querySelector('.terminal-spinner-subtext');
      if (subText) subText.textContent = subMessage;
    }
  }
  
  function hideSpinner() {
    if (terminalSpinner) {
      terminalSpinner.classList.remove('active');
    }
  }
  
  function updateSpinnerMessage(message, subMessage) {
    if (spinnerMessage) spinnerMessage.textContent = message;
    const subText = terminalSpinner?.querySelector('.terminal-spinner-subtext');
    if (subText && subMessage) subText.textContent = subMessage;
  }

  // ─── Events from Header ────────────────────────────────────────────────────

  document.addEventListener('serverStatusUpdate', (e) => {
    const statusObj = e.detail;
    const currentStatus = statusObj.status;

    // Mostrar/ocultar banner de inicio
    const startingBanner = DOM.get('console-starting');
    if (startingBanner) {
      startingBanner.classList.toggle('active', currentStatus === 'STARTING');
    }

    // Control del spinner según el estado
    if (currentStatus === 'STARTING') {
      showSpinner('INICIANDO SERVIDOR...', 'Por favor espera mientras el servidor arranca');
    } else if (currentStatus === 'ONLINE') {
      // Si es la primera vez que se conecta, mostrar spinner brevemente
      if (isFirstLoad) {
        showSpinner('CONECTANDO...', 'Estableciendo conexión con el servidor');
        setTimeout(() => {
          hideSpinner();
          isFirstLoad = false;
        }, 1000);
      } else {
        hideSpinner();
      }
      commandInput.removeAttribute('disabled');
      btnSendCommand.removeAttribute('disabled');
    } else if (currentStatus === 'OFFLINE') {
      showSpinner('SERVIDOR OFFLINE', 'El servidor no está disponible');
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
    
    // Mostrar spinner mientras se ejecuta el comando
    showSpinner('EJECUTANDO COMANDO...', `> ${cmd}`);
    commandInput.setAttribute('disabled', 'true');
    btnSendCommand.setAttribute('disabled', 'true');
    
    try {
      await ServerModel.sendCommand(serverId, cmd);
      commandInput.value = '';
      
      // Esperar un momento para ver el spinner
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('Error al ejecutar comando:', error);
    } finally {
      // Ocultar spinner y rehabilitar input si el servidor está online
      hideSpinner();
      const statusBadge = DOM.get('status-badge');
      if (statusBadge && statusBadge.classList.contains('online')) {
        commandInput.removeAttribute('disabled');
        btnSendCommand.removeAttribute('disabled');
      }
    }
  }
  
  // ─── UI Toggles & History ──────────────────────────────────────────────────
  
  DOM.on(btnLive, 'click', () => {
    btnLive.setAttribute('active', '');
    btnHistory.removeAttribute('active');

    terminalContainer.style.display = 'block';
    historyContainer.style.display = 'none';
    
    // Si no hay logs, mostrar spinner de carga
    if (terminalOutput.childNodes.length === 0) {
      showSpinner('ESPERANDO LOGS...', 'Conectando al servidor...');
    }
  });

  DOM.on(btnHistory, 'click', () => {
    btnHistory.setAttribute('active', '');
    btnLive.removeAttribute('active');

    terminalContainer.style.display = 'none';
    historyContainer.style.display = 'block';
    historyTableWrapper.style.display = 'none';
    historySpinner.classList.add('active');

    loadHistory(1);
  });

  async function loadHistory(page) {
    historyPage = page;
    const prevBtn = DOM.get('btn-history-prev');
    const nextBtn = DOM.get('btn-history-next');
    const pageInfo = DOM.get('history-page-info');
    
    // Mostrar spinner de historial
    historySpinner.classList.add('active');
    historyTableWrapper.style.display = 'none';
    prevBtn.setAttribute('disabled', 'true');
    nextBtn.setAttribute('disabled', 'true');

    const data = await API.call(`/${serverId}/logs/history?page=${page}&limit=${historyLimit}`, 'GET', null, '/api/server', true);
    
    // Ocultar spinner
    historySpinner.classList.remove('active');
    historyTableWrapper.style.display = 'block';

    if (!data || !data.logs || data.logs.length === 0) {
      historyTableWrapper.innerHTML = `
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
            <td style="font-family: var(--font-mono); font-size: 0.85rem; color: #bbb;">${escapeHtml(log.message)}</td>
          </tr>
      `);
    });

    rows.push(`
        </tbody>
      </table>
    `);

    historyTableWrapper.innerHTML = rows.join('');
    
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
  let logsReceived = false;

  function connectWebSocket() {
    if (currentWs) currentWs.close();
    if (wsKeepaliveTimer) clearInterval(wsKeepaliveTimer);
    
    // Mostrar spinner mientras se conecta
    if (!logsReceived) {
      showSpinner('CONECTANDO AL SERVIDOR...', 'Estableciendo conexión WebSocket');
    }
    
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
      
      // Ocultar spinner después de conectar si ya hay logs
      if (logsReceived) {
        hideSpinner();
      } else {
        updateSpinnerMessage('CONECTADO', 'Esperando logs del servidor...');
      }
    };

    currentWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          const line = data.log ?? data.content;
          if (line) {
            logsReceived = true;
            hideSpinner(); // Ocultar spinner cuando llegan logs
            appendLog(typeof line === 'object' ? line.message : line);
          }
        } else if (data.type === 'snapshot') {
          if (Array.isArray(data.logs)) {
            // Limpiar terminal y mostrar snapshot
            terminalOutput.innerHTML = '';
            data.logs.forEach((ln) => {
              appendLog(typeof ln === 'object' ? ln.message : ln);
            });
            logsReceived = true;
            hideSpinner(); // Ocultar spinner cuando se recibe el snapshot
          }
        }
      } catch (e) {
        // ignore
      }
    };

    currentWs.onclose = () => {
      if (wsKeepaliveTimer) { clearInterval(wsKeepaliveTimer); wsKeepaliveTimer = null; }
      setWsStatus(false);
      
      // Mostrar spinner de reconexión
      if (logsReceived) {
        showSpinner('RECONECTANDO...', 'La conexión se ha perdido, reconectando...');
      }
      
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
    else if (line.includes('Done') || line.includes('Started')) div.classList.add('success');
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

  // Mostrar spinner inicial
  showSpinner('CARGANDO CONSOLA...', 'Inicializando conexión con el servidor');
  
  connectWebSocket();
});