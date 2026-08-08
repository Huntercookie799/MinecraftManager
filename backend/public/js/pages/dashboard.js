import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';
import '../components/UIButton.js';

import { UIProgress } from '../components/UIProgress.js';

document.addEventListener('DOMContentLoaded', async () => {
  if (!API.token) {
    API.logout();
    return;
  }

  DOM.on('btn-logout', 'click', (e) => {
    e.preventDefault();
    API.logout();
  });

  const modal = DOM.get('new-server-modal');
  DOM.on('btn-show-new-server', 'click', () => DOM.show(modal));
  DOM.on('btn-cancel-new-server', 'click', () => DOM.hide(modal));

  DOM.on('btn-create-server', 'click', async () => {
    UIProgress.show('Creando servidor...');

    const name = DOM.get('new-server-name').value;
    const memory = DOM.get('new-server-memory').value;
    const port = DOM.get('new-server-port').value;

    const res = await ServerModel.create(name, port, memory);
    
    UIProgress.hide();

    if (res && res.success) {
      DOM.hide(modal);
      loadServers();
    }
  });

  await loadServers();

  async function loadServers() {
    const list = DOM.get('servers-list');
    list.innerHTML = '<p style="color: var(--text-color);">Cargando servidores...</p>';
    
    const servers = await ServerModel.getAll();
    if (!servers) return;

    list.innerHTML = '';
    if (servers.length === 0) {
      list.innerHTML = '<p style="color: var(--text-color);">No hay servidores creados.</p>';
      return;
    }

    servers.forEach(server => {
      const st = server.status?.status || 'OFFLINE';
      const isOnline = st === 'ONLINE';
      const isStarting = st === 'STARTING';
      
      let badgeClass = 'offline';
      if (isOnline) badgeClass = 'online';
      if (isStarting) badgeClass = 'starting';

      const card = DOM.create('div', 'card');
      card.innerHTML = `
        <h3>
          ${server.name}
          <div class="status-badge ${badgeClass}" style="margin-left: auto; font-size: 0.8rem; padding: 4px 10px;">
            <div class="dot"></div>
            <span class="text">${st}</span>
          </div>
        </h3>
        <div class="info-card">
          <p><strong>ID:</strong> <span>${server.id}</span></p>
          <p><strong>Puerto:</strong> <span>${server.port}</span></p>
          <p><strong>Memoria:</strong> <span>${server.memory}</span></p>
          <p><strong>Jugadores:</strong> <span>${server.status?.players || 0}/${server.status?.maxPlayers || 0}</span></p>
        </div>
        <div style="margin-top: 20px;">
          <ui-button variant="blue" id="manage-btn-${server.id}"><i data-lucide="settings"></i> Administrar Servidor</ui-button>
        </div>
      `;
      list.appendChild(card);
      
      DOM.on(`manage-btn-${server.id}`, 'click', () => {
        window.location.href = `/server.html?id=${server.id}`;
      });
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
});
