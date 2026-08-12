import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import '../utils/Alerts.js'; // registra UIModal y crea window.Alerts (instancia global)

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');

  if (!serverId) { window.location.href = '/dashboard.html'; return; }

  // Info del servidor (versión/software) para filtrar la búsqueda de addons
  let currentServer = null;

  // ── Header ──────────────────────────────────────────────────────────────
  async function loadHeader() {
    try {
      const [statusRes, serverListRes, worldsRes] = await Promise.all([
        API.call(`/${serverId}/status`, 'GET', null, '/api/server'),
        API.call('/', 'GET', null, '/api/server'),
        API.call('/', 'GET', null, `/api/server/${serverId}/worlds`).catch(() => null)
      ]);
      const server = serverListRes?.servers?.find(s => s.id == serverId);
      if (server) {
        currentServer = server;
        document.getElementById('current-server-name').textContent = server.name;
        document.getElementById('current-server-info').textContent = `${server.memory} | Puerto: ${server.port}`;
        const desc = document.getElementById('modpacks-desc');
        if (desc && server.version) {
          desc.textContent = `Los modpacks más descargados de Modrinth compatibles con Minecraft ${server.version}. Al instalar se descargan los mods en la carpeta mods/ y se copian los overrides (configuraciones).`;
        }
      }
      
      const activeWorld = worldsRes?.worlds?.find(w => w.isActive);
      if (activeWorld) {
        const worldInfo = document.getElementById('current-world-info');
        const worldName = document.getElementById('active-world-name');
        if (worldInfo && worldName) {
          worldName.textContent = activeWorld.name;
          worldInfo.style.display = 'block';
        }

        const modsContent = document.getElementById('mods-content');
        const modsDisabledMessage = document.getElementById('mods-disabled-message');
        if (modsContent && modsDisabledMessage) {
          const isMod = server && (server.softwareType === 'fabric' || server.softwareType === 'forge');
          let disabled = false;
          let addonType = isMod ? 'mods' : 'plugins';
          
          if (isMod && activeWorld.allowMods === false) disabled = true;
          if (!isMod && activeWorld.allowPlugins === false) disabled = true;

          if (disabled) {
            modsContent.style.display = 'none';
            modsDisabledMessage.style.display = 'block';
            const h3 = modsDisabledMessage.querySelector('h3');
            const p = modsDisabledMessage.querySelector('p');
            if (h3) h3.textContent = `${addonType.charAt(0).toUpperCase() + addonType.slice(1)} deshabilitados para este mundo`;
            if (p) p.innerHTML = `El perfil actual no permite el uso de ${addonType}. Puedes habilitarlo editando el mundo en la pestaña <strong>Mundos</strong>.`;
          } else {
            modsContent.style.display = 'block';
            modsDisabledMessage.style.display = 'none';
          }
        }
      }

      const badge = document.getElementById('status-badge');
      const text  = document.getElementById('status-text');
      if (badge && statusRes) {
        badge.className = `status-badge ${statusRes.status}`;
        text.textContent = { offline: 'Apagado', starting: 'Iniciando...', online: 'En línea', stopping: 'Deteniendo...' }[statusRes.status] ?? statusRes.status;
      }
    } catch (e) { console.error('Header error:', e); }
  }

  // ── Cargar lista de mods/plugins ─────────────────────────────────────────
  async function loadAddons() {
    const tbody = document.getElementById('addons-table-body');
    try {
      const res = await API.call(`/${serverId}/addons`, 'GET', null, '/api/server');
      const addons = res?.items ?? [];
      if (addons.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);">No hay mods ni plugins instalados</td></tr>';
        return;
      }
      tbody.innerHTML = addons.map(a => {
        const isMod = a.type === 'mod';
        const icon = isMod ? 'package' : 'plug';
        const color = isMod ? 'var(--color-blue)' : 'var(--color-warning)';
        const label = isMod ? 'MOD' : 'PLUGIN';
        return `
        <tr>
          <td><i data-lucide="${icon}" style="width:14px;height:14px;vertical-align:middle;margin-right:6px;color:${color};"></i>${a.name}</td>
          <td><span class="status-badge ${isMod ? 'online' : 'warning'}" style="font-size:0.68rem;padding:2px 8px;">${label}</span></td>
          <td>${a.size}</td>
          <td>${new Date(a.modified).toLocaleDateString()}</td>
          <td>
            <ui-button variant="danger" size="sm" class="btn-delete-addon" data-name="${a.name}" data-type="${a.type}" style="width:auto;">
              <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
            </ui-button>
          </td>
        </tr>
      `}).join('');
      if (window.lucide) lucide.createIcons({ root: tbody });

      tbody.querySelectorAll('.btn-delete-addon').forEach(btn => {
        btn.addEventListener('click', async () => {
          const ok = await window.Alerts.confirm({
            title: 'Eliminar addon',
            message: `¿Eliminar "${btn.dataset.name}"?`,
            sub: 'Esta acción es irreversible.',
            danger: true,
            confirmLabel: 'Sí, eliminar',
            icon: 'trash-2'
          });
          if (!ok) return;
          try {
            await API.call(`/${serverId}/addons/${encodeURIComponent(btn.dataset.name)}?type=${btn.dataset.type}`, 'DELETE', null, '/api/server');
            window.Toast?.show('Eliminado correctamente', 'success');
            loadAddons();
          } catch (e) { window.Toast?.show('Error al eliminar', 'error'); }
        });
      });
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-danger);">Error al cargar mods</td></tr>';
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
      // El backend busca en GET /api/server/:id/addons/search?q=&version=&loader=
      const version = currentServer?.version || '';
      let loader = currentServer?.softwareType || '';
      if (loader === 'purpur') loader = 'paper'; // equivalencia usada por el backend
      const qs = new URLSearchParams({ q });
      if (version) qs.set('version', version);
      if (loader) qs.set('loader', loader);
      const res = await API.call(`/${serverId}/addons/search?${qs.toString()}`, 'GET', null, '/api/server');
      const hits = res?.items ?? [];
      
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
          ${h.iconUrl ? `<img src="${h.iconUrl}" style="width:32px;height:32px;border-radius:4px;flex-shrink:0;">` : '<div style="width:32px;height:32px;background:var(--bg-card);border-radius:4px;flex-shrink:0;"></div>'}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.875rem;">${h.name}</div>
            <div style="color:var(--text-dim);font-size:0.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${h.description ?? ''}</div>
          </div>
          <ui-button variant="success" size="sm" class="btn-install-addon" data-id="${h.id}" data-source="${h.source}" style="width:auto;flex-shrink:0;">
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
      // La subida es POST /api/server/:id/addons (multipart, campo 'addon')
      const res = await fetch(`/api/server/${serverId}/addons`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('mm_token')}` },
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

  // ── Descargar .zip (plugins / mods / ambos) ──────────────────────────────
  document.getElementById('btn-download-mods')?.addEventListener('click', async () => {
    const sel = document.getElementById('download-select');
    const mode = sel?.value || 'plugins';
    const labels = { plugins: 'plugins', mods: 'mods', both: 'mods y plugins' };
    window.Toast?.show(`Preparando descarga de ${labels[mode] ?? 'addons'}...`, 'info');
    try {
      const token = localStorage.getItem('mm_token');
      // plugins → ?path=plugins · mods → ?path=mods · ambos → ?both=1
      const qs = mode === 'both' ? 'both=1' : `path=${mode}`;
      const res = await fetch(`/api/server/${serverId}/files/download?${qs}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        let msg = 'Error al descargar';
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mode === 'both' ? `mods_y_plugins_${serverId}.zip` : `${mode}_${serverId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.Toast?.show('Descarga iniciada', 'success');
    } catch (e) {
      window.Toast?.show('Error al descargar: ' + (e?.message || ''), 'error');
    }
  });

  // ── Modpacks recomendados ────────────────────────────────────────────────
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmtDownloads = (n) => {
    if (!n && n !== 0) return '';
    return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' :
           n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n);
  };

  async function loadModpacks() {
    const grid = document.getElementById('modpacks-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="color:var(--text-dim);padding:10px;">Cargando modpacks...</div>';
    try {
      const res = await API.call(`/${serverId}/modpacks/recommended`, 'GET', null, '/api/server');
      const items = res?.items ?? [];
      if (items.length === 0) {
        grid.innerHTML = '<div style="color:var(--text-dim);padding:10px;">No se pudieron cargar los modpacks recomendados (¿sin conexión a Modrinth?).</div>';
        return;
      }
      grid.innerHTML = items.map(m => `
        <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:8px;">
          ${m.iconUrl
            ? `<img src="${esc(m.iconUrl)}" alt="" style="width:100%;height:110px;object-fit:cover;border-radius:6px;background:var(--bg-core);" onerror="this.style.display='none';">`
            : '<div style="width:100%;height:110px;background:var(--bg-core);border-radius:6px;display:flex;align-items:center;justify-content:center;"><i data-lucide="box" style="width:28px;height:28px;color:var(--text-dim);"></i></div>'}
          <div style="font-weight:600;font-size:0.85rem;line-height:1.3;">${esc(m.name)}</div>
          <div style="color:var(--text-dim);font-size:0.75rem;flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(m.description)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.72rem;color:var(--text-dim);">
            <span>${fmtDownloads(m.downloads)} descargas</span>
            <span class="status-badge ${m.source === 'modrinth' ? 'online' : 'warning'}" style="font-size:0.62rem;padding:1px 6px;">${m.source.toUpperCase()}</span>
          </div>
          <ui-button variant="success" size="sm" class="btn-install-modpack" data-id="${esc(m.id)}" data-source="${esc(m.source)}" data-name="${esc(m.name)}" style="width:100%;">
            <i data-lucide="download" style="width:13px;height:13px;"></i> Instalar
          </ui-button>
        </div>
      `).join('');
      if (window.lucide) lucide.createIcons({ root: grid });

      grid.querySelectorAll('.btn-install-modpack').forEach(btn => {
        btn.addEventListener('click', async () => {
          const isModServer = currentServer && ['fabric', 'forge', 'neoforge', 'quilt'].includes(currentServer.softwareType);
          const ok = await window.Alerts.confirm({
            title: 'Instalar modpack',
            message: `¿Instalar el modpack "${btn.dataset.name}"?`,
            sub: isModServer
              ? 'Se descargarán los mods del modpack en la carpeta mods/ del servidor y se copiarán los overrides.'
              : `Ojo: ${currentServer?.name ?? 'este servidor'} usa ${currentServer?.softwareType ?? 'otro software'} y NO carga mods. Los archivos se van a instalar igual en mods/, pero necesitás un servidor Fabric/Forge/NeoForge para jugar el modpack.`,
            confirmLabel: 'Sí, instalar',
            icon: 'box'
          });
          if (!ok) return;
          btn.disabled = true;
          window.Toast?.show('Instalando modpack, puede tardar unos segundos...', 'info');
          try {
            const res = await API.call(`/${serverId}/modpacks/install`, 'POST', { projectId: btn.dataset.id, source: btn.dataset.source }, '/api/server');
            const warn = (res?.message || '').includes('Ojo');
            window.Toast?.show(res?.message || 'Modpack instalado', warn ? 'warning' : 'success');
            loadAddons();
          } catch (e) {
            window.Toast?.show('Error al instalar el modpack: ' + (e?.message || ''), 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      grid.innerHTML = '<div style="color:var(--text-danger);padding:10px;">Error al cargar los modpacks recomendados.</div>';
    }
  }

  document.getElementById('btn-refresh-modpacks')?.addEventListener('click', loadModpacks);

  // ── Instalar modpack de CurseForge por Project ID ───────────────────────
  // La búsqueda de CurseForge puede estar bloqueada según el tipo de API key;
  // este campo permite instalar directo con el ID numérico del proyecto.
  const installCurseForgeById = async () => {
    const input = document.getElementById('cf-project-id');
    const raw = (input?.value || '').trim();
    const match = raw.match(/\d{4,}/);
    if (!match) {
      window.Toast?.show('Ingresá el Project ID numérico de CurseForge (ej. 715304)', 'warning');
      return;
    }
    const projectId = match[0];
    const ok = await window.Alerts.confirm({
      title: 'Instalar modpack de CurseForge',
      message: `¿Instalar el proyecto de CurseForge #${projectId}?`,
      sub: 'Se descargarán los mods en mods/ y se copiarán los overrides. Asegurate de que el ID sea de un modpack (no de un mod suelto).',
      confirmLabel: 'Sí, instalar',
      icon: 'box'
    });
    if (!ok) return;
    const btn = document.getElementById('btn-install-cf-id');
    if (btn) btn.disabled = true;
    window.Toast?.show('Instalando modpack de CurseForge, puede tardar unos minutos...', 'info');
    try {
      const res = await API.call(`/${serverId}/modpacks/install`, 'POST', { projectId, source: 'curseforge' }, '/api/server');
      const warn = (res?.message || '').includes('Ojo');
      window.Toast?.show(res?.message || 'Modpack instalado', warn ? 'warning' : 'success');
      loadAddons();
    } catch (e) {
      window.Toast?.show('Error al instalar el modpack: ' + (e?.message || ''), 'error');
    } finally {
      if (btn) btn.disabled = false;
      if (input) input.value = '';
    }
  };
  document.getElementById('btn-install-cf-id')?.addEventListener('click', installCurseForgeById);

  // ── Init ─────────────────────────────────────────────────────────────────
  await Promise.all([loadHeader(), loadAddons(), loadModpacks()]);
});
