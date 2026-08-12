import { DOM } from '../utils/dom.js';
import { WorldModel } from '../models/World.js';
import { API } from '../utils/api.js';
import '../utils/Alerts.js'; // registra UIModal y crea window.Alerts (instancia global)
import '../components/index.js';
import { ServerHeader } from './server-header.js';

document.addEventListener('DOMContentLoaded', async () => {
  ServerHeader.init().catch(() => {});

  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) return;

  const skeleton  = document.getElementById('worlds-skeleton');
  const worldsList = document.getElementById('worlds-list');

  // ── Modal: Crear Mundo ───────────────────────────────────────────────────
  const modalNew = DOM.get('new-world-modal');
  DOM.on('btn-show-new-world', 'click', () => DOM.show(modalNew));
  DOM.on('btn-cancel-new-world', 'click', () => DOM.hide(modalNew));

  DOM.on('btn-create-world', 'click', async () => {
    const nameEl = document.getElementById('new-world-name');
    const name = (nameEl?.querySelector('input') ?? nameEl)?.value?.trim();
    if (!name) { window.Toast?.show('Ingresa un nombre para el mundo', 'warning'); return; }
    const allowModsEl = document.getElementById('new-world-allow-mods');
    const allowPluginsEl = document.getElementById('new-world-allow-plugins');
    const allowMods = allowModsEl ? allowModsEl.checked : true;
    const allowPlugins = allowPluginsEl ? allowPluginsEl.checked : true;

    const modpackSel = document.getElementById('new-world-modpack');
    const modpackVal = modpackSel?.value;
    const modpack = modpackVal ? { source: modpackVal.split(':')[0], id: modpackVal.split(':').slice(1).join(':') } : null;

    const btn = document.getElementById('btn-create-world');
    if (btn) btn.disabled = true;
    window.Toast?.show(modpack ? `Creando mundo "${name}" con modpack (puede tardar)...` : `Creando mundo "${name}"...`, 'info');
    try {
      const res = await WorldModel.create(serverId, name, allowMods, allowPlugins, modpack);
      const info = res?.world?.modpack;
      if (info) {
        window.Toast?.show(`Modpack "${info.name}" instalado en el mundo (${info.installed} archivos${info.failed ? `, ${info.failed} fallaron` : ''})`, info.installed > 0 ? 'success' : 'warning');
      }
      DOM.hide(modalNew);
      loadWorlds();
    } catch (e) {
      window.Toast?.show('Error al crear el mundo', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // ── Modal: Editar Mundo ──────────────────────────────────────────────────
  const modalEdit = DOM.get('edit-world-modal');
  DOM.on('btn-cancel-edit-world', 'click', () => DOM.hide(modalEdit));

  DOM.on('btn-save-edit-world', 'click', async () => {
    const worldId = document.getElementById('edit-world-id')?.value;
    const nameEl  = document.getElementById('edit-world-name');
    const newName = (nameEl?.querySelector('input') ?? nameEl)?.value?.trim();
    if (!worldId || !newName) return;
    const allowModsEl = document.getElementById('edit-world-allow-mods');
    const allowPluginsEl = document.getElementById('edit-world-allow-plugins');
    const allowMods = allowModsEl ? allowModsEl.checked : true;
    const allowPlugins = allowPluginsEl ? allowPluginsEl.checked : true;
    try {
      const res = await WorldModel.update(serverId, worldId, newName, allowMods, allowPlugins);
      if (res?.error) { window.Toast?.show(res.error, 'error'); return; }
      window.Toast?.show('Mundo renombrado correctamente', 'success');
      DOM.hide(modalEdit);
      loadWorlds();
    } catch (e) { window.Toast?.show('Error al renombrar el mundo', 'error'); }
  });

  // ── Modal: Tutorial / Manual PDF ─────────────────────────────────────────
  DOM.on('btn-close-tutorial', 'click', () => DOM.hide(DOM.get('tutorial-modal')));

  DOM.on('btn-download-pdf', 'click', async () => {
    const pdfBtn = document.getElementById('btn-download-pdf');
    const worldId   = pdfBtn?.dataset.id;
    const worldName = pdfBtn?.dataset.world;
    if (!worldId) return;
    window.Toast?.show('Generando manual PDF...', 'info');
    try {
      const token = localStorage.getItem('mm_token');
      const res = await fetch(`/api/server/${serverId}/worlds/${worldId}/tutorial.pdf`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        let msg = 'Error al generar el PDF';
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `manual-${worldName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.Toast?.show('Manual PDF descargado', 'success');
    } catch (e) {
      window.Toast?.show('Error al generar el PDF: ' + (e?.message || ''), 'error');
    }
  });

  // ── Modal de Búsqueda de Modpacks ──────────────────────────────────────────
  const modpackSearchModal = DOM.get('modpack-search-modal');
  const modpackSearchInput = DOM.get('modpack-search-input');
  const modpackSearchResults = DOM.get('modpack-search-results');
  const modpackSearchStatus = DOM.get('modpack-search-status');
  const modpackSearchView = DOM.get('modpack-search-view');
  const modpackDetailsView = DOM.get('modpack-details-view');
  const modpackDetailsContent = DOM.get('modpack-details-content');

  function showSearchView() {
    modpackSearchView.style.display = 'flex';
    modpackDetailsView.style.display = 'none';
  }

  function showDetailsView() {
    modpackSearchView.style.display = 'none';
    modpackDetailsView.style.display = 'flex';
  }

  DOM.on('btn-back-to-search', 'click', () => {
    showSearchView();
  });

  DOM.on('btn-search-modpack', 'click', () => {
    DOM.show(modpackSearchModal);
    showSearchView();
    if (!modpackSearchResults.innerHTML) {
      modpackSearchInput.value = '';
      const category = DOM.get('modpack-search-category').value;
      executeModpackSearch('', category);
    }
  });

  DOM.on('btn-close-modpack-search', 'click', () => DOM.hide(modpackSearchModal));

  DOM.on('btn-execute-modpack-search', 'click', () => {
    const category = DOM.get('modpack-search-category').value;
    executeModpackSearch(modpackSearchInput.value, category);
  });
  modpackSearchInput?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      const category = DOM.get('modpack-search-category').value;
      executeModpackSearch(modpackSearchInput.value, category);
    }
  });

  DOM.on('btn-clear-modpack', 'click', () => {
    DOM.get('new-world-modpack').value = '';
    DOM.get('selected-modpack-name').textContent = '';
    DOM.get('selected-modpack-name').style.display = 'none';
    DOM.get('btn-clear-modpack').style.display = 'none';
  });

  async function executeModpackSearch(query, category) {
    modpackSearchStatus.style.display = 'block';
    modpackSearchStatus.textContent = 'Buscando modpacks...';
    modpackSearchResults.innerHTML = '';
    const btnSearch = DOM.get('btn-execute-modpack-search');
    if (btnSearch) btnSearch.disabled = true;

    try {
      let endpoint = `/${serverId}/addons/search?limit=24&type=modpack`;
      if (query) endpoint += `&q=${encodeURIComponent(query)}`;
      else endpoint += `&q=popular`; // Si está vacío, traemos algo por defecto. Aunque la API exige 'q'. 'modpack' también sirve.
      if (category) endpoint += `&category=${encodeURIComponent(category)}`;
      
      const res = await API.call(endpoint);
      if (!res) return; // Error ya manejado por API.call
      if (res.error) throw new Error(res.error);

      if (!res.items || res.items.length === 0) {
        modpackSearchStatus.textContent = 'No se encontraron modpacks.';
        return;
      }

      modpackSearchStatus.style.display = 'none';
      modpackSearchResults.style.display = 'grid';
      modpackSearchResults.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
      modpackSearchResults.style.gap = '14px';

      res.items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.margin = '0';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.justifyContent = 'space-between';

        const desc = item.description || 'Sin descripción';
        
        const categoriesHtml = (item.categories || []).slice(0, 3).map(c => `<span style="background:var(--bg-card-hover);color:var(--text-main);font-size:0.7rem;padding:2px 6px;border-radius:4px;white-space:nowrap;">${c}</span>`).join('');
        const versionsText = (item.versions && item.versions.length > 0) ? `Versiones: ${item.versions.slice(0, 4).join(', ')}${item.versions.length > 4 ? '...' : ''}` : '';

        card.innerHTML = `
          <div style="display:flex;gap:12px;margin-bottom:12px;">
            ${item.iconUrl ? `<img src="${item.iconUrl}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;">` : `<div style="width:48px;height:48px;border-radius:8px;background:var(--bg-card-hover);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i data-lucide="box" style="width:24px;height:24px;color:var(--text-dim)"></i></div>`}
            <div>
              <h4 style="margin:0 0 4px 0;font-size:1rem;color:var(--text-main);">${item.name}</h4>
              <p style="margin:0;font-size:0.75rem;color:var(--text-dim);">
                ${item.source === 'modrinth' ? '<span style="color:#1bd96a;">Modrinth</span>' : '<span style="color:#f16436;">CurseForge</span>'} • 
                ${item.downloads.toLocaleString()} descargas
              </p>
            </div>
          </div>
          <p style="font-size:0.85rem;color:var(--text-dim);margin:0 0 10px 0;line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">${desc}</p>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">${categoriesHtml}</div>
          ${versionsText ? `<p style="font-size:0.75rem;color:var(--text-dim);margin:0 0 14px 0;">${versionsText}</p>` : '<div style="margin-bottom:14px;"></div>'}
          <div style="display:flex;gap:8px;">
            <button class="ui-button btn-select" style="background:var(--primary);color:var(--bg-main);border:none;border-radius:var(--border-radius);padding:8px;font-weight:600;cursor:pointer;flex:1;">
              Seleccionar
            </button>
            <button class="ui-button btn-details" style="background:var(--bg-card-hover);color:var(--text-main);border:none;border-radius:var(--border-radius);padding:8px;font-weight:600;cursor:pointer;flex:1;">
              Ver Detalles
            </button>
          </div>
        `;

        const selectModpack = () => {
          DOM.get('new-world-modpack').value = `${item.source}:${item.id}`;
          const nameSpan = DOM.get('selected-modpack-name');
          nameSpan.textContent = item.name;
          nameSpan.style.display = 'inline';
          DOM.get('btn-clear-modpack').style.display = 'inline-block';
          DOM.hide(modpackSearchModal);
        };

        card.querySelector('.btn-select').addEventListener('click', selectModpack);

        card.querySelector('.btn-details').addEventListener('click', async () => {
          showDetailsView();
          modpackDetailsContent.innerHTML = '<p style="color:var(--text-dim);">Cargando detalles...</p>';
          
          const detailsRes = await API.call(`/${serverId}/addons/details/${item.source}/${item.id}`);
          if (!detailsRes || !detailsRes.project) {
            modpackDetailsContent.innerHTML = '<p style="color:#f16436;">Error al cargar los detalles del modpack.</p>';
            return;
          }
          
          const p = detailsRes.project;
          const modsText = p.modCount > 0 ? `<b>${p.modCount}</b> mods` : 'Cantidad de mods desconocida';
          
          let bodyHtml = p.body || p.description || 'Sin descripción detallada.';
          if (item.source === 'modrinth' && p.body && window.marked) {
            bodyHtml = window.marked.parse(p.body);
          }
          
          modpackDetailsContent.innerHTML = `
            <div style="display:flex;gap:16px;align-items:center;">
              ${p.iconUrl ? `<img src="${p.iconUrl}" style="width:80px;height:80px;border-radius:12px;object-fit:cover;">` : `<div style="width:80px;height:80px;border-radius:12px;background:var(--bg-card-hover);display:flex;align-items:center;justify-content:center;"><i data-lucide="box" style="width:40px;height:40px;color:var(--text-dim)"></i></div>`}
              <div>
                <h2 style="margin:0 0 8px 0;color:var(--text-main);">${p.name}</h2>
                <p style="margin:0;color:var(--text-dim);font-size:0.9rem;">
                  ${item.source === 'modrinth' ? '<span style="color:#1bd96a;">Modrinth</span>' : '<span style="color:#f16436;">CurseForge</span>'} • 
                  ${p.downloads.toLocaleString()} descargas • ${modsText}
                </p>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
              ${p.categories.map(c => `<span style="background:var(--bg-card-hover);color:var(--text-main);font-size:0.8rem;padding:4px 8px;border-radius:4px;">${c}</span>`).join('')}
            </div>
            <hr style="border:none;border-top:1px solid var(--border-color);margin:8px 0;">
            <div class="markdown-body" style="color:var(--text-dim);line-height:1.6;font-size:0.9rem;word-wrap:break-word;">
              ${bodyHtml}
            </div>
          `;
          
          // Re-registrar iconos
          if (window.lucide) window.lucide.createIcons();
          
          const btnSelectDetails = DOM.get('btn-select-modpack-details');
          // Limpiar event listeners previos
          const newBtn = btnSelectDetails.cloneNode(true);
          btnSelectDetails.parentNode.replaceChild(newBtn, btnSelectDetails);
          newBtn.addEventListener('click', selectModpack);
        });

        modpackSearchResults.appendChild(card);
      });
      if (window.lucide) lucide.createIcons({ root: modpackSearchResults });

    } catch (e) {
      modpackSearchStatus.textContent = 'Error: ' + e.message;
    } finally {
      if (btnSearch) btnSearch.disabled = false;
    }
  }

  // ── Cargar mundos ────────────────────────────────────────────────────────
  async function loadWorlds() {
    skeleton.style.display  = 'flex';
    worldsList.style.display = 'none';
    worldsList.innerHTML    = '';

    let worlds = await WorldModel.getAll(serverId);

    if (!worlds || worlds.length === 0) {
      // Auto-crear mundo por defecto si no existe ninguno
      try {
        await WorldModel.create(serverId, 'world');
        worlds = await WorldModel.getAll(serverId);
      } catch (e) { /* ignorar */ }
    }

    skeleton.style.display = 'none';
    worldsList.style.display = 'block';

    if (!worlds || worlds.length === 0) {
      worldsList.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--text-dim);">
          <i data-lucide="globe" style="width:32px;height:32px;opacity:0.3;display:block;margin:0 auto 10px;"></i>
          No hay mundos disponibles
        </div>`;
      if (window.lucide) lucide.createIcons({ root: worldsList });
      return;
    }

    // Tabla de mundos
    worldsList.innerHTML = `
      <table class="data-table" style="width:100%;">
        <thead>
          <tr>
            <th>Mundo</th>
            <th>Carpeta</th>
            <th>Estado</th>
            <th>Tamaño</th>
            <th style="width:220px;text-align:right;">Acciones</th>
          </tr>
        </thead>
        <tbody id="worlds-tbody"></tbody>
      </table>
    `;

    const tbody = document.getElementById('worlds-tbody');

    worlds.forEach(w => {
      const isActive = w.isActive ?? false;
      const folder   = w.path || w.name;
      const sizeMB   = w.sizeBytes ? (w.sizeBytes / 1024 / 1024).toFixed(2) + ' MB' : (isActive ? '—' : '0.00 MB');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            ${isActive
              ? '<span style="display:inline-flex;align-items:center;justify-content:center;width:8px;height:8px;border-radius:50%;background:var(--color-success);flex-shrink:0;"></span>'
              : '<span style="display:inline-flex;align-items:center;justify-content:center;width:8px;height:8px;border-radius:50%;background:var(--border-color);flex-shrink:0;"></span>'}
            <strong style="font-size:0.9rem;">${w.name}</strong>
          </div>
        </td>
        <td><code style="font-size:0.8rem;color:var(--text-dim);">${folder}</code></td>
        <td>
          <span class="status-badge ${isActive ? 'online' : 'offline'}" style="font-size:0.75rem;padding:3px 10px;">
            <span class="dot"></span>
            <span class="text">${isActive ? 'Activo' : 'Inactivo'}</span>
          </span>
        </td>
        <td style="color:var(--text-dim);font-size:0.85rem;">${sizeMB}</td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
            ${!isActive ? `<button class="world-action-btn btn-activate-world" data-id="${w.id}" data-world="${w.name}" title="Activar perfil">
              <i data-lucide="play-circle" style="width:14px;height:14px;"></i>
            </button>` : ''}
            <button class="world-action-btn btn-edit-world" data-id="${w.id}" data-world="${w.name}" data-allowmods="${w.allowMods}" data-allowplugins="${w.allowPlugins}" title="Editar mundo">
              <i data-lucide="edit-3" style="width:14px;height:14px;"></i>
            </button>
            <button class="world-action-btn btn-tutorial-world" data-id="${w.id}" data-world="${w.name}" title="Tutorial de descarga (SKLauncher)">
              <i data-lucide="book-open" style="width:14px;height:14px;"></i>
            </button>
            <button class="world-action-btn btn-files-world" data-id="${w.id}" data-world="${w.name}" title="Ver archivos">
              <i data-lucide="folder-open" style="width:14px;height:14px;"></i>
            </button>
            <button class="world-action-btn btn-download-world" data-id="${w.id}" data-world="${w.name}" title="Descargar como .zip">
              <i data-lucide="download" style="width:14px;height:14px;"></i>
            </button>
            <button class="world-action-btn btn-delete-world danger ${isActive ? 'disabled-btn' : ''}" data-id="${w.id}" data-world="${w.name}" title="Eliminar mundo" ${isActive ? 'disabled' : ''}>
              <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons({ root: tbody });

    // ── Activar ───────────────────────────────────────────────────────────
    tbody.querySelectorAll('.btn-activate-world').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await window.Alerts.confirm({
          title: 'Activar mundo',
          message: `¿Deseas activar el perfil "${btn.dataset.world}"?`,
          sub: 'El servidor debe estar apagado para intercambiar las carpetas del mundo.',
          confirmLabel: 'Sí, activar',
          icon: 'play-circle'
        });
        if (!ok) return;
        try {
          const res = await WorldModel.activate(serverId, btn.dataset.id);
          if (res && !res.error) loadWorlds();
        } catch (e) {
          console.error(e);
        }
      });
    });

    // ── Editar ────────────────────────────────────────────────────────────
    tbody.querySelectorAll('.btn-edit-world').forEach(btn => {
      btn.addEventListener('click', () => {
        const worldId   = btn.dataset.id;
        const worldName = btn.dataset.world;
        const allowMods = btn.dataset.allowmods === 'true';
        const allowPlugins = btn.dataset.allowplugins === 'true';
        const idEl   = document.getElementById('edit-world-id');
        const nameEl = document.getElementById('edit-world-name');
        const allowModsEl = document.getElementById('edit-world-allow-mods');
        const allowPluginsEl = document.getElementById('edit-world-allow-plugins');
        if (idEl) idEl.value = worldId;
        if (nameEl) (nameEl.querySelector('input') ?? nameEl).value = worldName;
        if (allowModsEl) allowModsEl.checked = allowMods;
        if (allowPluginsEl) allowPluginsEl.checked = allowPlugins;
        DOM.show(modalEdit);
      });
    });

    // ── Tutorial de descarga (SKLauncher) ─────────────────────────────────
    tbody.querySelectorAll('.btn-tutorial-world').forEach(btn => {
      btn.addEventListener('click', async () => {
        const worldId   = btn.dataset.id;
        const worldName = btn.dataset.world;
        const contentEl = document.getElementById('tutorial-content');
        const modal     = document.getElementById('tutorial-modal');
        const pdfBtn    = document.getElementById('btn-download-pdf');
        if (!contentEl || !modal) return;

        contentEl.innerHTML = '<p style="color:var(--text-dim);font-size:0.85rem;">Cargando tutorial...</p>';
        DOM.show(modal);

        try {
          const data = await WorldModel.getTutorial(serverId, worldId);
          const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
          const modsBadge = data.mods > 0
            ? `<span class="status-badge online" style="font-size:0.7rem;padding:2px 8px;">${data.mods} mods</span>`
            : '';
          contentEl.innerHTML = `
            <div>
              <strong style="font-size:0.95rem;">${esc(data.world)}</strong>
              <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
                ${modsBadge}
                ${data.plugins > 0 ? `<span class="status-badge warning" style="font-size:0.7rem;padding:2px 8px;">${data.plugins} plugins</span>` : ''}
                <span class="status-badge offline" style="font-size:0.7rem;padding:2px 8px;">${esc(data.version)}</span>
                <span class="status-badge" style="font-size:0.7rem;padding:2px 8px;">${esc(data.hostname)}:${data.port}</span>
              </div>
            </div>
            <p style="color:var(--text-main);font-size:0.88rem;line-height:1.55;margin:0;">${esc(data.intro)}</p>
            ${data.steps.map(s => `
              <div>
                <div style="font-weight:600;font-size:0.85rem;color:var(--color-blue);margin-bottom:4px;">${esc(s.title)}</div>
                <div style="color:var(--text-dim);font-size:0.82rem;line-height:1.55;white-space:pre-line;">${esc(s.text)}</div>
              </div>
            `).join('')}
          `;

          pdfBtn.dataset.world = worldName;
          pdfBtn.dataset.id = worldId;
        } catch (e) {
          contentEl.innerHTML = '<p style="color:var(--text-danger);font-size:0.85rem;">Error al cargar el tutorial.</p>';
        }
      });
    });

    // ── Ver archivos (navega a server-files con path del mundo) ──────────
    tbody.querySelectorAll('.btn-files-world').forEach(btn => {
      btn.addEventListener('click', () => {
        const worldName = btn.dataset.world;
        window.location.href = `/server-files.html?id=${serverId}&path=${encodeURIComponent(worldName)}`;
      });
    });

    // ── Descargar como .zip ──────────────────────────────────────────────
    tbody.querySelectorAll('.btn-download-world').forEach(btn => {
      btn.addEventListener('click', async () => {
        const worldId   = btn.dataset.id;
        const worldName = btn.dataset.world;
        window.Toast?.show(`Calculando contenido de "${worldName}"...`, 'info');
        try {
          // Mostrar cuántos mods/plugins/configs incluye el mundo antes de bajar
          let summary = '';
          try {
            const st = await WorldModel.getStats(serverId, worldId);
            if (st) {
              const parts = [];
              const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;
              if (st.mods) parts.push(plural(st.mods, 'mod'));
              if (st.plugins) parts.push(plural(st.plugins, 'plugin'));
              if (st.configs) parts.push(plural(st.configs, 'config'));
              if (st.defaultconfigs) parts.push(plural(st.defaultconfigs, 'config por defecto'));
              if (st.resourcepacks) parts.push(plural(st.resourcepacks, 'resource pack'));
              if (parts.length) summary = ` (${parts.join(', ')})`;
            }
          } catch (e) { /* sin stats */ }
          window.Toast?.show(`Descargando "${worldName}"${summary}...`, 'info');

          const token = localStorage.getItem('mm_token');
          const res = await fetch(`/api/server/${serverId}/worlds/${worldId}/export`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (!res.ok) {
            let msg = 'Error al descargar';
            try { const j = await res.json(); if (j?.error) msg = j.error; } catch { msg = await res.text(); }
            throw new Error(msg);
          }

          const blob = await res.blob();
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href     = url;
          a.download = `${worldName}.zip`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          window.Toast?.show(`"${worldName}.zip" descargado`, 'success');
        } catch (e) {
          window.Toast?.show('Error al descargar el mundo: ' + e.message, 'error');
        }
      });
    });

    // ── Eliminar ─────────────────────────────────────────────────────────
    tbody.querySelectorAll('.btn-delete-world:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const worldName = btn.dataset.world;
        const ok = await window.Alerts.confirm({
          title: 'Eliminar mundo',
          message: `¿Eliminar el mundo "${worldName}"?`,
          sub: 'Esta acción es irreversible. Los archivos del mundo se borrarán permanentemente.',
          danger: true,
          confirmLabel: 'Sí, eliminar',
          icon: 'trash-2'
        });
        if (!ok) return;
        try {
          await WorldModel.delete(serverId, btn.dataset.id);
          loadWorlds();
        } catch (e) { window.Toast?.show('Error al eliminar el mundo', 'error'); }
      });
    });
  }

  loadWorlds();
});
