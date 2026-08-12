import { API } from '../utils/api.js';

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) { window.location.href = '/dashboard.html'; return; }

  async function loadHeader() {
    try {
      const [statusRes, listRes] = await Promise.all([
        API.call(`/${serverId}/status`, 'GET', null, '/api/server'),
        API.call('/', 'GET', null, '/api/server'),
      ]);
      const server = listRes?.servers?.find(s => s.id == serverId);
      if (server) {
        document.getElementById('current-server-name').textContent = server.name;
        document.getElementById('current-server-info').textContent = `${server.memory} | Puerto: ${server.port}`;
        const ipEl = document.getElementById('info-ip');
        const portEl = document.getElementById('info-port');
        if (ipEl) ipEl.textContent = statusRes?.host ?? server.host ?? '--';
        if (portEl) portEl.textContent = server.port ?? '--';
        const copyBtn = document.getElementById('btn-copy-ip');
        if (copyBtn) {
          copyBtn.style.display = 'inline-flex';
          copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(`${statusRes?.host ?? server.host}:${server.port}`);
            window.Toast?.show('Dirección copiada', 'success');
          });
        }
      }
      const badge = document.getElementById('status-badge');
      const text = document.getElementById('status-text');
      if (badge && statusRes) {
        badge.className = `status-badge ${statusRes.status}`;
        text.textContent = { offline: 'Apagado', starting: 'Iniciando...', online: 'En línea', stopping: 'Deteniendo...' }[statusRes.status] ?? statusRes.status;
      }
    } catch (e) { console.error('Header error:', e); }
  }

  async function loadForwardStatus() {
    try {
      const res = await API.call(`/${serverId}/forward/status`, 'GET', null, '/api/server');
      const statusEl = document.getElementById('forward-status');
      const urlEl = document.getElementById('forward-url');
      const targetEl = document.getElementById('forward-target');
      const stopBtn = document.getElementById('btn-forward-stop');
      if (!res) return;
      if (res.active) {
        if (statusEl) statusEl.textContent = `Activo en puerto ${res.port}`;
        if (urlEl) { urlEl.style.display = 'block'; urlEl.textContent = `URL: ${res.url ?? ''}`; }
        if (stopBtn) stopBtn.disabled = false;
      } else {
        if (statusEl) statusEl.textContent = 'Inactivo';
      }
      if (targetEl) targetEl.textContent = res.target ?? '--';
    } catch (e) { console.error('Forward status error:', e); }
  }

  async function loadHostname() {
    try {
      const res = await API.call(`/${serverId}/hostname`, 'GET', null, '/api/server');
      const input = document.getElementById('hostname-input');
      const clearBtn = document.getElementById('btn-hostname-clear');
      const statusEl = document.getElementById('hostname-status');
      const routerEl = document.getElementById('router-status');
      if (res?.hostname) {
        if (input) {
          const i = input.querySelector('input') ?? input;
          i.value = res.hostname;
        }
        if (clearBtn) clearBtn.disabled = false;
        if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = `Hostname activo: ${res.hostname}`; }
        if (routerEl) routerEl.textContent = res.routerStatus ?? '';
      }
    } catch (e) { console.error('Hostname error:', e); }
  }

  // Forward port select
  const portSelect = document.getElementById('forward-port-select');
  const portCustom = document.getElementById('forward-port-custom');
  portSelect?.addEventListener('change', () => {
    if (portCustom) portCustom.style.display = portSelect.value === 'custom' ? 'inline-flex' : 'none';
  });

  // Start forward
  document.getElementById('btn-forward-start')?.addEventListener('click', async () => {
    const port = portSelect?.value === 'custom' ? (portCustom?.querySelector('input')?.value ?? portCustom?.value) : portSelect?.value;
    try {
      await API.call(`/${serverId}/forward/start`, 'POST', { port }, '/api/server');
      window.Toast?.show(`Servidor expuesto en puerto ${port}`, 'success');
      loadForwardStatus();
    } catch (e) { window.Toast?.show('Error al exponer puerto', 'error'); }
  });

  // Stop forward
  document.getElementById('btn-forward-stop')?.addEventListener('click', async () => {
    try {
      await API.call(`/${serverId}/forward/stop`, 'POST', {}, '/api/server');
      window.Toast?.show('Exposición detenida', 'info');
      const stopBtn = document.getElementById('btn-forward-stop');
      if (stopBtn) stopBtn.disabled = true;
      const statusEl = document.getElementById('forward-status');
      if (statusEl) statusEl.textContent = 'Inactivo';
      const urlEl = document.getElementById('forward-url');
      if (urlEl) urlEl.style.display = 'none';
    } catch (e) { window.Toast?.show('Error al detener exposición', 'error'); }
  });

  // Hostname save
  document.getElementById('btn-hostname-save')?.addEventListener('click', async () => {
    const input = document.getElementById('hostname-input');
    const val = (input?.querySelector('input') ?? input)?.value?.trim();
    if (!val) { window.Toast?.show('Ingresa un hostname', 'warning'); return; }
    try {
      await API.call(`/${serverId}/hostname`, 'POST', { hostname: val }, '/api/server');
      window.Toast?.show('Hostname guardado', 'success');
      loadHostname();
    } catch (e) { window.Toast?.show('Error al guardar hostname', 'error'); }
  });

  // Hostname clear
  document.getElementById('btn-hostname-clear')?.addEventListener('click', async () => {
    try {
      await API.call(`/${serverId}/hostname`, 'DELETE', null, '/api/server');
      window.Toast?.show('Hostname eliminado', 'info');
      const input = document.getElementById('hostname-input');
      if (input) (input.querySelector('input') ?? input).value = '';
      const clearBtn = document.getElementById('btn-hostname-clear');
      if (clearBtn) clearBtn.disabled = true;
      const statusEl = document.getElementById('hostname-status');
      if (statusEl) statusEl.style.display = 'none';
    } catch (e) { window.Toast?.show('Error al eliminar hostname', 'error'); }
  });

  await Promise.all([loadHeader(), loadForwardStatus(), loadHostname()]);
});
