import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';
import { CommandAutocomplete } from '../utils/CommandAutocomplete.js';
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

// ─── Colores ANSI → HTML (los logs de Minecraft traen secuencias \x1b[...m) ──
const ANSI_BASIC = {
  '30': '#000000', '31': '#AA0000', '32': '#00AA00', '33': '#AA5500',
  '34': '#0000AA', '35': '#AA00AA', '36': '#00AAAA', '37': '#AAAAAA',
  '90': '#555555', '91': '#FF5555', '92': '#55FF55', '93': '#FFFF55',
  '94': '#5555FF', '95': '#FF55FF', '96': '#55FFFF', '97': '#FFFFFF'
};

const ANSI_16 = [0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0,
                 0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff];

function xterm256ToHex(n) {
  if (n < 16) return '#' + ANSI_16[n].toString(16).padStart(6, '0');
  if (n < 232) {
    const i = n - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const r = levels[Math.floor(i / 36)], g = levels[Math.floor((i % 36) / 6)], b = levels[i % 6];
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  const gray = 8 + (n - 232) * 10;
  const h = gray.toString(16).padStart(2, '0');
  return '#' + h + h + h;
}

// Convierte texto con secuencias ANSI en HTML con spans de color
function ansiToHtml(text) {
  const re = /\x1b\[([0-9;]*)m/g;
  let html = '';
  let open = false;
  let last = 0;
  let m;
  let color = null;
  let bold = false;

  const apply = (codes) => {
    if (codes[0] === 0) { color = null; bold = false; }
    else if (codes[0] === 1) bold = true;
    else if (codes[0] === 22) bold = false;
    else if (codes[0] === 38 && codes[1] === 2) color = `rgb(${codes[2]},${codes[3]},${codes[4]})`;
    else if (codes[0] === 38 && codes[1] === 5) color = xterm256ToHex(codes[2]);
    else if (ANSI_BASIC[codes[0]]) color = ANSI_BASIC[codes[0]];
    else if (codes[0] === 39) color = null;
  };

  while ((m = re.exec(text))) {
    html += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;
    apply(m[1].split(';').map(Number));
    if (open) { html += '</span>'; open = false; }
    if (color || bold) {
      const s = [];
      if (color) s.push(`color:${color}`);
      if (bold) s.push('font-weight:700');
      html += `<span style="${s.join(';')}">`;
      open = true;
    }
  }
  html += escapeHtml(text.slice(last));
  if (open) html += '</span>';
  return html;
}

// Formato estándar de Purpur/Paper: [HH:MM:SS NIVEL]: mensaje
const LOG_FORMAT_RE = /^(\[\d{2}:\d{2}:\d{2} )(\[?[A-Z]+\]?)(\]: )(.*)$/s;
const LOG_LEVEL_COLORS = {
  'INFO': '#55FFFF', 'WARN': '#FFAA00', 'ERROR': '#FF5555', 'FATAL': '#FF5555',
  'DEBUG': '#AAAAAA', 'TRACE': '#888888'
};

// Renderiza una línea de log con estilo (timestamp, nivel y colores ANSI)
function renderLogLine(line) {
  const m = line.match(LOG_FORMAT_RE);
  if (m) {
    const [, ts, level, sep, rest] = m;
    const levelColor = LOG_LEVEL_COLORS[level] || '#AAAAAA';
    return `<span class="log-ts">${escapeHtml(ts)}</span>` +
      `<span class="log-level" style="color:${levelColor}">${escapeHtml(level)}</span>` +
      `<span class="log-sep">${escapeHtml(sep)}</span>` +
      ansiToHtml(rest);
  }
  // Comandos enviados desde el panel
  if (line.startsWith('>')) {
    return `<span style="color:#55FFFF;font-weight:700">${ansiToHtml(line)}</span>`;
  }
  return ansiToHtml(line);
}

// ─── Main ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) return;

  // El header (nombre/avatar/estado) se inicializa en paralelo, SIN bloquear la
  // conexión del WebSocket: los logs llegan por WS, no del header. Así el
  // terminal se llena al instante aunque el header tarde.
  ServerHeader.init().catch(() => {});

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
  
  function showSpinner(message = 'CARGANDO LOGS...', subMessage = 'Esperando conexión con el servidor') {}
  function hideSpinner() {}
  function updateSpinnerMessage(message, subMessage) {}

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
  
  // ─── Autocompletado de comandos (estilo Minecraft) ────────────────────────
  // Utilidad reutilizable en public/js/utils/CommandAutocomplete.js
  const autocomplete = new CommandAutocomplete(commandInput, {
    container: DOM.get('cmd-suggestions')
  });
  autocomplete.attach();

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
    historyContainer.style.display = 'flex';
    historyTableWrapper.style.display = 'none';
    historySpinner.classList.add('active');

    loadHistory(1);
  });

  const historySearchInput = DOM.get('history-search-input');
  const btnHistorySearch = DOM.get('btn-history-search');
  const chipsContainer = DOM.get('history-search-chips');
  const searchContainer = DOM.get('history-search-container');
  let searchFilters = [];

  if (searchContainer && historySearchInput) {
    historySearchInput.addEventListener('focus', () => searchContainer.style.borderColor = '#4f8cf7');
    historySearchInput.addEventListener('blur', () => searchContainer.style.borderColor = 'var(--border-color, #333)');
  }

  function renderSearchChips() {
    if (!chipsContainer) return;
    chipsContainer.innerHTML = '';
    searchFilters.forEach((filter, index) => {
      const chip = DOM.create('div', 'search-chip');
      chip.style.cssText = 'background: rgba(79, 140, 247, 0.15); color: #4f8cf7; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; display: flex; align-items: center; gap: 5px; border: 1px solid rgba(79,140,247,0.3);';
      chip.innerHTML = `<span>${escapeHtml(filter)}</span><button class="remove-chip" style="background:none;border:none;color:#4f8cf7;cursor:pointer;padding:0;font-size:14px;line-height:1;">&times;</button>`;
      chip.querySelector('.remove-chip').addEventListener('click', () => {
        searchFilters.splice(index, 1);
        renderSearchChips();
        loadHistory(1);
      });
      chipsContainer.appendChild(chip);
    });
  }

  if (btnHistorySearch && historySearchInput) {
    DOM.on(btnHistorySearch, 'click', () => loadHistory(1));
    DOM.on(historySearchInput, 'keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.ctrlKey) {
          const val = (historySearchInput.querySelector('input')?.value || historySearchInput.value || '').trim();
          if (val && !searchFilters.includes(val)) {
            searchFilters.push(val);
            renderSearchChips();
            if (historySearchInput.querySelector('input')) historySearchInput.querySelector('input').value = '';
            else historySearchInput.value = '';
            loadHistory(1);
          }
        } else {
          loadHistory(1);
        }
      }
    });
  }

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

    const searchVal = historySearchInput ? (historySearchInput.querySelector('input')?.value || historySearchInput.value || '').trim() : '';
    let url = `/${serverId}/logs/history?page=${page}&limit=${historyLimit}`;
    
    const allSearches = [...searchFilters];
    if (searchVal && !allSearches.includes(searchVal)) {
      allSearches.push(searchVal);
    }
    
    if (allSearches.length > 0) {
      allSearches.forEach(s => {
        url += `&search=${encodeURIComponent(s)}`;
      });
    }

    const data = await API.call(url, 'GET', null, '/api/server', true);
    
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

    // Build Terminal layout for history
    const rows = [];
    rows.push(`<div class="terminal" style="height: 100%; border-radius: 0; padding: 0; overflow: visible;">`);

    data.logs.forEach(log => {
      const date = new Date(log.createdAt).toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      let levelColor = '#aaa';
      let levelClass = '';
      if (log.level === 'WARN') { levelColor = '#facc15'; levelClass = 'warn'; }
      else if (log.level === 'ERROR' || log.level === 'FATAL') { levelColor = '#ef4444'; levelClass = 'error'; }
      else if (log.level === 'INFO') { levelColor = '#4f8cf7'; levelClass = 'info'; }

      rows.push(`<div class="terminal-line ${levelClass}"><span class="log-ts" style="color: #666; margin-right: 8px;">[${date}]</span> <span class="log-level" style="color: ${levelColor}; font-weight: bold;">[${log.level}]</span><span class="log-sep">:</span> <span style="color: #e0e0e0; margin-left: 8px;">${escapeHtml(log.message)}</span></div>`);
    });

    rows.push(`</div>`);

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
    // Las líneas con formato estándar (timestamp+nivel) se colorean por span;
    // las de sistema conservan la clase por nivel.
    if (!LOG_FORMAT_RE.test(line)) {
      if (line.includes('WARN')) div.classList.add('warn');
      else if (line.includes('ERROR') || line.includes('Exception')) div.classList.add('error');
      else if (line.includes('Done') || line.includes('Started')) div.classList.add('success');
    }
    div.innerHTML = renderLogLine(line);
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