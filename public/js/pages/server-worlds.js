import { DOM } from '../utils/dom.js';
import { WorldModel } from '../models/World.js';
import '../components/index.js';
import { ServerHeader } from './server-header.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar Header
  await ServerHeader.init();

  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) return;

  const modalWorld = DOM.get('new-world-modal');
  DOM.on('btn-show-new-world', 'click', () => DOM.show(modalWorld));
  DOM.on('btn-cancel-new-world', 'click', () => DOM.hide(modalWorld));
  
  DOM.on('btn-create-world', 'click', async () => {
    const name = DOM.get('new-world-name').value;
    await WorldModel.create(serverId, name);
    DOM.hide(modalWorld);
    loadWorlds();
  });

  async function loadWorlds() {
    const list = DOM.get('worlds-list');
    list.innerHTML = '<p>Cargando mundos...</p>';
    
    const worlds = await WorldModel.getAll(serverId);
    list.innerHTML = '';

    if (!worlds || worlds.length === 0) {
      // Auto-create default world if none exists
      list.innerHTML = '<p>Creando mundo por defecto...</p>';
      try {
        await WorldModel.create(serverId, 'world');
        // Fetch again to display
        const newWorlds = await WorldModel.getAll(serverId);
        if (newWorlds && newWorlds.length > 0) {
          worlds = newWorlds;
        } else {
          list.innerHTML = '<p>No se encontraron mundos.</p>';
          return;
        }
      } catch (e) {
        list.innerHTML = '<p>Error al crear el mundo por defecto.</p>';
        return;
      }
    }

    worlds.forEach(w => {
      const isLoaded = w.isLoaded ?? false;
      const isActive = w.isActive ?? false;
      const folder = w.path || w.name;
      const sizeMB = w.sizeBytes ? (w.sizeBytes / 1024 / 1024).toFixed(2) : (w.isActive ? '—' : '0.00');
      
      const card = DOM.create('div', 'world-card');
      card.innerHTML = `
        <div class="world-thumbnail">
          ${isActive ? '<span class="world-badge">Activo</span>' : ''}
        </div>
        <div class="world-info">
          <h4>${w.name}</h4>
          <p>Carpeta: ${folder}</p>
          <p>Estado: ${isActive ? 'Activo' : 'Descargado'}</p>
          <p>Tamaño: ${sizeMB} MB</p>
        </div>
        <div class="world-actions">
          <ui-button variant="blue" class="btn-load-world" data-world="${w.name}" ${isActive ? 'disabled' : ''}><i data-lucide="upload-cloud"></i> Cargar</ui-button>
          <ui-button variant="danger" class="btn-delete-world" data-world="${w.name}" ${isActive ? 'disabled' : ''}><i data-lucide="trash-2"></i> Borrar</ui-button>
        </div>
      `;
      list.appendChild(card);
    });

    DOM.on('.btn-load-world', 'click', async (e) => {
      const worldName = e.target.closest('ui-button').getAttribute('data-world');
      await WorldModel.load(serverId, worldName);
      loadWorlds();
    });

    DOM.on('.btn-delete-world', 'click', async (e) => {
      const worldName = e.target.closest('ui-button').getAttribute('data-world');
      if (confirm('¿Borrar mundo ' + worldName + '?')) {
        await WorldModel.delete(serverId, worldName);
        loadWorlds();
      }
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  loadWorlds();
});
