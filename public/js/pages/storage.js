import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import '../components/index.js';
import { UIProgress } from '../components/UIProgress.js';

document.addEventListener('DOMContentLoaded', async () => {
  if (!API.token) {
    API.logout();
    return;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async function loadStorage() {
    const list = DOM.get('storage-list');
    try {
      const res = await API.call('/spaces', 'GET', null, '/api/storage');
      if (res && res.success) {
        if (res.servers.length === 0) {
          list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim);">No hay servidores registrados.</div>';
          return;
        }

        list.innerHTML = '';
        res.servers.forEach(server => {
          const card = DOM.create('div');
          card.style.cssText = 'border:1px solid var(--border-color); border-radius:var(--border-radius); padding:15px; margin-bottom:15px; background:var(--bg-panel);';
          
          let worldsHtml = '';
          if (server.worlds && server.worlds.length > 0) {
            worldsHtml = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 15px;">' + server.worlds.map(w => `
              <div style="border: 1px solid var(--border-color); border-radius: var(--border-radius); padding: 15px; background: var(--bg-core); display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; transition: transform 0.2s;">
                <i data-lucide="folder" style="width: 48px; height: 48px; color: var(--primary);"></i>
                <div style="width: 100%;">
                  <strong style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1.05rem;" title="${w.name}">${w.name}</strong>
                  <span style="font-size: 0.75rem; color: var(--text-dim);">${w.type === 'active' ? 'En Uso' : 'Copia Local'}</span>
                </div>
                <div style="font-family: var(--font-mono); font-size: 0.95rem; margin-bottom: auto;">${formatBytes(w.size)}</div>
                <div style="display: flex; gap: 8px; width: 100%; margin-top: 8px; align-items: stretch;">
                  <ui-button variant="secondary" style="flex: 1; font-size: 0.85rem; padding: 6px 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; justify-content: center; align-items: center; gap: 5px;" class="btn-sync-world" data-server="${server.id}" data-folder="${w.type === 'backup' ? 'worlds_backup/' + w.name : w.name}">
                    <i data-lucide="cloud-upload" style="width:14px;height:14px; flex-shrink: 0;"></i> <span style="overflow: hidden; text-overflow: ellipsis;">Sync Nube</span>
                  </ui-button>
                  ${w.type === 'backup' ? `
                  <ui-button variant="danger" style="flex: 0 0 40px; padding: 0; display:flex; justify-content:center; align-items:center;" class="btn-delete-world" data-server="${server.id}" data-folder="worlds_backup/${w.name}" title="Eliminar Definitivamente">
                    <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
                  </ui-button>
                  ` : ''}
                </div>
              </div>
            `).join('') + '</div>';
          } else {
            worldsHtml = '<div style="color:var(--text-dim); font-size:0.85rem; padding:8px 0;">No se encontraron mundos</div>';
          }

          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <div>
                <h4 style="margin:0; font-size:1.1rem;">${server.name}</h4>
                <div style="font-size:0.8rem; color:var(--text-dim); font-family:var(--font-mono); margin-top:4px;">${server.path}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:1.2rem; font-weight:bold; font-family:var(--font-mono);">${formatBytes(server.totalSize)}</div>
                <div style="font-size:0.75rem; color:var(--text-dim);">Total en disco</div>
              </div>
            </div>
            
            <div style="margin-top:15px;">
              <h5 style="margin:0 0 10px 0; color:var(--text-main);">Mundos Detectados</h5>
              ${worldsHtml}
            </div>

            <div style="margin-top:15px; text-align:right;">
              <ui-button variant="primary" class="btn-sync-server" data-server="${server.id}">
                <i data-lucide="cloud-upload"></i> Sincronizar Todo el Servidor
              </ui-button>
            </div>
          `;
          list.appendChild(card);
        });

        // Eventos de botones
        document.querySelectorAll('.btn-sync-server').forEach(btn => {
          btn.addEventListener('click', async () => {
            const serverId = btn.getAttribute('data-server');
            await syncStorage(serverId, null);
          });
        });

        document.querySelectorAll('.btn-sync-world').forEach(btn => {
          btn.addEventListener('click', async () => {
            const serverId = btn.getAttribute('data-server');
            const folder = btn.getAttribute('data-folder');
            await syncStorage(serverId, folder);
          });
        });

        document.querySelectorAll('.btn-delete-world').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('¿Estás seguro de que quieres eliminar esta copia local permanentemente? No se podrá recuperar.')) return;
            const serverId = btn.getAttribute('data-server');
            const folder = btn.getAttribute('data-folder');
            await deleteStorage(serverId, folder);
          });
        });

        if (window.lucide) {
          window.lucide.createIcons();
        }

      } else {
        list.innerHTML = '<div style="color:var(--color-danger);">Error al cargar el almacenamiento</div>';
      }
    } catch (e) {
      list.innerHTML = `<div style="color:var(--color-danger);">Error de conexión: ${e.message}</div>`;
    }
  }

  async function syncStorage(serverId, folder) {
    UIProgress.show(folder ? 'Subiendo mundo a la nube...' : 'Subiendo backup del servidor a la nube...');
    try {
      const res = await API.call('/sync', 'POST', { serverId: parseInt(serverId), folder }, '/api/storage');
      if (res && res.success) {
        window.Toast?.show('Sincronización iniciada/completada con éxito.', 'success');
      } else {
        window.Toast?.show(res.error || 'Error desconocido al sincronizar', 'error');
      }
    } catch (e) {
      window.Toast?.show(e.message, 'error');
    } finally {
      UIProgress.hide();
    }
  }

  async function deleteStorage(serverId, folder) {
    UIProgress.show('Eliminando archivo local permanentemente...');
    try {
      const res = await API.call('/delete', 'DELETE', { serverId: parseInt(serverId), folder }, '/api/storage');
      if (res && res.success) {
        window.Toast?.show('Archivo eliminado con éxito', 'success');
        await loadStorage(); // Recargar la lista
      } else {
        window.Toast?.show(res.error || 'Error al eliminar', 'error');
      }
    } catch (e) {
      window.Toast?.show(e.message, 'error');
    } finally {
      UIProgress.hide();
    }
  }

  await loadStorage();
});
