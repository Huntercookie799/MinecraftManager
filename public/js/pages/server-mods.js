import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');

  if (!serverId) { window.location.href = '/dashboard.html'; return; }

  // ── Header ──────────────────────────────────────────────────────────────
  async function loadHeader() {
    try {
      const [statusRes, serverListRes] = await Promise.all([
        API.call(`/${serverId}/status`, 'GET', null, '/api/server'),
        API.call('/', 'GET', null, '/api/server'),
      ]);
      const server = serverListRes?.servers?.find(s => s.id == serverId);
      if (server) {
        document.getElementById('current-server-name').textContent = server.name;
        document.getElementById('current-server-info').textContent = `${server.memory} | Puerto: ${server.port}`;
      }
      const badge = document.getElementById('status-badge');
      const text  = document.getElementById('status-text');
      if (badge && statusRes) {
        badge.className = `status-badge ${statusRes.status}`;
        text.textContent = { offline: 'Apagado', starting: 'Iniciando...', online: 'En línea', stopping: 'Deteniendo...' }[statusRes.status] ?? statusRes.status;
      }
    } catch (e) { console.error('Header error:', e); }
  }

  // ── Cargar lista de mods ─────────────────────────────────────────────────
  async function loadAddons() {
    const tbody = document.getElementById('addons-table-body');
    try {
      const res = await API.call(`/${serverId}/addons`, 'GET', null, '/api/server');
      const addons = res?.addons ?? [];
      if (addons.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim);">No hay mods instalados</td></tr>';
        return;
      }
      tbody.innerHTML = addons.map(a => `
        <tr>
          <td><i data-lucide="file" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;"></i>${a.name}</td>
          <td>${a.size}</td>
          <td>${new Date(a.modified).toLocaleDateString()}</td>
          <td>
            <ui-button variant="danger" size="sm" class="btn-delete-addon" data-name="${a.name}" style="width:auto;">
              <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
            </ui-button>
          </td>
        </tr>
      `).join('');
      if (window.lucide) lucide.createIcons({ root: tbody });

      tbody.querySelectorAll('.btn-delete-addon').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`¿Eliminar ${btn.dataset.name}?`)) return;
          try {
            await API.call(`/${serverId}/addons/${encodeURIComponent(btn.dataset.name)}`, 'DELETE', null, '/api/server');
            window.Toast?.show('Mod eliminado correctamente', 'success');
            loadAddons();
          } catch (e) { window.Toast?.show('Error al eliminar el mod', 'error'); }
        });
      });
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-danger);">Error al cargar mods</td></tr>';
    }
  }

  const searchInput = document.getElementById('addon-search');
  const searchBtn   = document.getElementById('btn-addon-search');
  const resultsBox  = document.getElementById('addon-search-results');
  const searchStatus = document.getElementById('addon-search-status');
  const searchModal = document.getElementById('search-modal');

  document.getElementById('btn-close-search')?.addEventListener('click', () => {
    DOM.hide(searchModal);
  });

  searchBtn?.addEventListener('click', async () => {
    const q = searchInput?.value?.trim();
    if (!q) return;
    
    // Mostramos estado en la tarjeta
    searchStatus.style.display = 'block';
    searchStatus.textContent = 'Buscando...';
    
    try {
      const res = await API.call(`/search?q=${encodeURIComponent(q)}&serverId=${serverId}`, 'GET', null, '/api/addons');
      const hits = res?.hits ?? [];
      
      searchStatus.style.display = 'none';
      
      // Abrimos el modal y mostramos resultados
      DOM.show(searchModal);
      resultsBox.style.display = 'flex';
      
      if (hits.length === 0) {
        resultsBox.innerHTML = '<div style="color:var(--text-dim);padding:10px;text-align:center;">Sin resultados</div>';
        return;
      }
      resultsBox.innerHTML = hits.map(h => `
        <div style="display:flex;gap:10px;align-items:center;padding:8px;border-bottom:1px solid var(--border-color);">
          ${h.icon ? `<img src="${h.icon}" style="width:32px;height:32px;border-radius:4px;flex-shrink:0;">` : '<div style="width:32px;height:32px;background:var(--bg-card);border-radius:4px;flex-shrink:0;"></div>'}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.875rem;">${h.name}</div>
            <div style="color:var(--text-dim);font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.description ?? ''}</div>
          </div>
          <ui-button variant="success" size="sm" class="btn-install-addon" data-id="${h.projectId}" data-source="${h.source}" style="width:auto;flex-shrink:0;">
            <i data-lucide="download" style="width:13px;height:13px;"></i>
          </ui-button>
        </div>
      `).join('');
      if (window.lucide) lucide.createIcons({ root: resultsBox });

      resultsBox.querySelectorAll('.btn-install-addon').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await API.call(`/${serverId}/addons/install`, 'POST', { projectId: btn.dataset.id, source: btn.dataset.source }, '/api/server');
            window.Toast?.show('Mod instalado correctamente', 'success');
            DOM.hide(searchModal);
            loadAddons();
          } catch (e) { window.Toast?.show('Error al instalar el mod', 'error'); }
          finally { btn.disabled = false; }
        });
      });
    } catch (e) {
      searchStatus.textContent = 'Error al buscar';
      searchStatus.style.color = 'var(--color-danger)';
    }
  });

  // ── Subida manual ────────────────────────────────────────────────────────
  const uploadBtn    = document.getElementById('btn-addon-upload');
  const addonFile    = document.getElementById('addon-file');
  const addonStatus  = document.getElementById('addon-status');

  uploadBtn?.addEventListener('click', async () => {
    const file = addonFile?.querySelector('input[type="file"]')?.files?.[0]
               ?? addonFile?.files?.[0];
    if (!file) { window.Toast?.show('Selecciona un archivo .jar', 'warning'); return; }

    addonStatus.style.display = 'block';
    addonStatus.textContent = 'Subiendo...';
    const formData = new FormData();
    formData.append('addon', file);

    try {
      const res = await fetch(`/api/server/${serverId}/addons/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      addonStatus.textContent = '✓ Subido correctamente';
      window.Toast?.show('Mod subido correctamente', 'success');
      loadAddons();
    } catch (e) {
      addonStatus.textContent = '✗ Error al subir: ' + e.message;
      window.Toast?.show('Error al subir el mod', 'error');
    }
  });

  // ── Refresh ──────────────────────────────────────────────────────────────
  document.getElementById('btn-refresh-addons')?.addEventListener('click', loadAddons);

  // ── Descargar Todos los Mods (.zip) ──────────────────────────────────────
  document.getElementById('btn-download-mods')?.addEventListener('click', async () => {
    window.Toast?.show('Preparando descarga de mods...', 'info');
    try {
      const token = localStorage.getItem('token');
      // Usamos el endpoint del file manager para descargar la carpeta "mods" entera
      const res = await fetch(`/api/server/${serverId}/files/download?path=mods`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(await res.text());

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mods_server_${serverId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.Toast?.show('Descarga iniciada', 'success');
    } catch (e) {
      window.Toast?.show('Error al descargar los mods. Verifica que la carpeta exista.', 'error');
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  await Promise.all([loadHeader(), loadAddons()]);
});
