import { API } from '../utils/api.js';
import '../components/index.js';

const REFRESH_MS = 5000;
const STATUS_TEXT = { offline: 'Apagado', starting: 'Iniciando...', online: 'En línea', stopping: 'Deteniendo...' };

function fmtUptime(seconds) {
  if (!seconds && seconds !== 0) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderNetwork(network, servers) {
  const lanEl = document.getElementById('mon-lan-ip');
  if (lanEl) lanEl.textContent = network.lanIp || '127.0.0.1';

  const copyBtn = document.getElementById('btn-copy-lan');
  if (copyBtn) {
    copyBtn.style.display = 'inline-flex';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(network.lanIp || '');
      window.Toast?.show('IP LAN copiada', 'success');
    };
  }

  // Router (puertos 80/443)
  const routerEl = document.getElementById('mon-router');
  if (routerEl && Array.isArray(network.router)) {
    routerEl.innerHTML = network.router.map((l) => `
      <span class="status-badge ${l.listening ? 'online' : 'offline'}" style="display:inline-flex;font-size:0.72rem;padding:4px 10px;">
        <span class="dot"></span>
        <span class="text">Puerto ${l.port} ${l.listening ? 'activo' : 'caído'}</span>
      </span>`).join('') || '<span class="mon-refresh-note">Proxy no iniciado</span>';
  }

  // Hostnames → servidores
  const tbody = document.getElementById('mon-hostnames');
  if (tbody) {
    const withHostname = (servers || []).filter((s) => s.hostname);
    tbody.innerHTML = withHostname.length === 0
      ? '<tr><td colspan="4" style="color:var(--text-dim);">Sin hostnames configurados</td></tr>'
      : withHostname.map((s) => {
          const st = String(s.status?.status || 'OFFLINE').toLowerCase();
          return `
          <tr>
            <td><span class="mon-ok">${esc(s.hostname)}</span></td>
            <td>${esc(s.name)}</td>
            <td>${s.port ?? '--'}</td>
            <td><span class="${st === 'online' ? 'mon-ok' : 'mon-bad'}">${STATUS_TEXT[st] ?? esc(st)}</span></td>
          </tr>`;
        }).join('');
  }

  // Interfaces
  const ifaceEl = document.getElementById('mon-interfaces');
  if (ifaceEl && Array.isArray(network.interfaces)) {
    ifaceEl.innerHTML = network.interfaces.map((i) => `
      <div class="mon-iface"><b>${esc(i.name)}</b> — ${i.addresses.map((a) => `${esc(a.family === 'IPv4' ? 'IPv4' : 'IPv6')} ${esc(a.address)}${a.internal ? ' (loopback)' : ''}`).join(' · ')}</div>`).join('');
  }
}

function renderSystem(system) {
  const setBar = (barId, pctId, pct, text) => {
    const bar = document.getElementById(barId);
    const el = document.getElementById(pctId);
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (el) el.textContent = text;
  };

  const cpu = system.cpuPercent ?? 0;
  setBar('mon-cpu-bar', 'mon-cpu-pct', cpu, `${cpu}%`);

  const used = system.usedMemMB ?? 0;
  const total = system.totalMemMB || 1;
  setBar('mon-ram-bar', 'mon-ram-pct', (used / total) * 100, `${Math.round((used / total) * 100)}%`);

  const uptimeEl = document.getElementById('mon-uptime');
  if (uptimeEl) uptimeEl.textContent = fmtUptime(system.uptimeSeconds);

  const coresEl = document.getElementById('mon-cores');
  if (coresEl) coresEl.textContent = `${system.cpuCount ?? '--'} CPU`;

  const loadEl = document.getElementById('mon-load');
  if (loadEl) loadEl.textContent = Array.isArray(system.loadAvg) ? system.loadAvg.join(' / ') : '--';

  const platEl = document.getElementById('mon-platform');
  if (platEl) platEl.textContent = `${system.hostname ?? '--'} · ${system.platform ?? '--'}`;
}

function renderServers(servers) {
  const container = document.getElementById('mon-servers');
  if (!container) return;

  if (!servers || servers.length === 0) {
    container.innerHTML = '<div class="card" style="color:var(--text-dim);">No hay servidores configurados</div>';
    return;
  }

  container.innerHTML =  servers.map((s) => {
    const st = s.status || {};
    const status = String(st.status || 'OFFLINE').toLowerCase();
    const badgeClass = ['online', 'starting', 'stopping'].includes(status) ? status : 'offline';
    const playerText = status === 'online' ? `${st.players ?? 0}/${st.maxPlayers ?? '?'}` : '--';
    const proc = s.process;
    const rssText = proc ? `${proc.rssMB} MB` : '--';
    const cpuText = proc ? `${proc.cpuPercent}%` : '--';

    return `
      <div class="card mon-server-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div class="server-name"><i data-lucide="server" style="width:16px;height:16px;color:var(--text-dim);"></i> ${esc(s.name)}</div>
          <span class="status-badge ${badgeClass}" style="display:inline-flex;font-size:0.7rem;padding:3px 10px;">
            <span class="dot"></span>
            <span class="text">${STATUS_TEXT[status] ?? esc(status)}</span>
          </span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <div class="mon-tile"><b>${playerText}</b><span>Jugadores</span></div>
          <div class="mon-tile"><b>${fmtUptime(st.uptime)}</b><span>Uptime</span></div>
          <div class="mon-tile"><b>${rssText}</b><span>RAM real</span></div>
          <div class="mon-tile"><b>${cpuText}</b><span>CPU</span></div>
        </div>
        <p style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-dim);margin-top:12px;">
          Puerto ${s.port ?? '--'} · Heap ${esc(s.memory ?? '--')}${s.hostname ? ` · ${esc(s.hostname)}` : ''}${st.version ? ` · ${esc(st.version)}` : ''}
        </p>
      </div>`;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: container });
}

async function load() {
  try {
    const data = await API.call('/overview', 'GET', null, '/api/monitor');
    if (!data) return;
    renderNetwork(data.network, data.servers);
    renderSystem(data.system);
    renderServers(data.servers);
    const el = document.getElementById('last-updated');
    if (el) el.textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error('Monitor error:', e);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btn-refresh')?.addEventListener('click', load);
  await load();
  setInterval(load, REFRESH_MS);
});
