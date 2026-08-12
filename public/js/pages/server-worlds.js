import { DOM } from '../utils/dom.js';
import { WorldModel } from '../models/World.js';
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
    await WorldModel.create(serverId, name);
    DOM.hide(modalNew);
    loadWorlds();
  });

  // ── Modal: Editar Mundo ──────────────────────────────────────────────────
  const modalEdit = DOM.get('edit-world-modal');
  DOM.on('btn-cancel-edit-world', 'click', () => DOM.hide(modalEdit));

  DOM.on('btn-save-edit-world', 'click', async () => {
    const worldId = document.getElementById('edit-world-id')?.value;
    const nameEl  = document.getElementById('edit-world-name');
    const newName = (nameEl?.querySelector('input') ?? nameEl)?.value?.trim();
    if (!worldId || !newName) return;
    try {
      const res = await WorldModel.update(serverId, worldId, newName);
      if (res?.error) { window.Toast?.show(res.error, 'error'); return; }
      window.Toast?.show('Mundo renombrado correctamente', 'success');
      DOM.hide(modalEdit);
      loadWorlds();
    } catch (e) { window.Toast?.show('Error al renombrar el mundo', 'error'); }
  });

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
          <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="world-action-btn btn-edit-world" data-world="${w.name}" title="Editar nombre">
              <i data-lucide="edit-3" style="width:14px;height:14px;"></i>
            </button>
            <button class="world-action-btn btn-files-world" data-world="${w.name}" title="Ver archivos">
              <i data-lucide="folder-open" style="width:14px;height:14px;"></i>
            </button>
            <button class="world-action-btn btn-download-world" data-world="${w.name}" title="Descargar como .zip">
              <i data-lucide="download" style="width:14px;height:14px;"></i>
            </button>
            <button class="world-action-btn btn-delete-world danger ${isActive ? 'disabled-btn' : ''}" data-world="${w.name}" title="Eliminar mundo" ${isActive ? 'disabled' : ''}>
              <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons({ root: tbody });

    // ── Editar ────────────────────────────────────────────────────────────
    tbody.querySelectorAll('.btn-edit-world').forEach(btn => {
      btn.addEventListener('click', () => {
        const worldName = btn.dataset.world;
        const idEl   = document.getElementById('edit-world-id');
        const nameEl = document.getElementById('edit-world-name');
        if (idEl) idEl.value = worldName;
        if (nameEl) (nameEl.querySelector('input') ?? nameEl).value = worldName;
        DOM.show(modalEdit);
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
        const worldName = btn.dataset.world;
        window.Toast?.show(`Preparando descarga de "${worldName}"...`, 'info');
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/server/${serverId}/worlds/${encodeURIComponent(worldName)}/download`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (!res.ok) throw new Error(await res.text());

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
        if (!confirm(`¿Eliminar el mundo "${worldName}"? Esta acción es irreversible.`)) return;
        try {
          await WorldModel.delete(serverId, worldName);
          loadWorlds();
        } catch (e) { window.Toast?.show('Error al eliminar el mundo', 'error'); }
      });
    });
  }

  loadWorlds();
});
