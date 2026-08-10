import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';
import '../components/index.js';

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
  let versionsLoaded = false;

  DOM.on('btn-show-new-server', 'click', async () => {
    if (!versionsLoaded) {
      const versionSelect = DOM.get('new-server-version');
      const data = await API.call('/versions');
      if (data && Array.isArray(data.versions) && data.versions.length > 0) {
        versionSelect.innerHTML = data.versions.map(v => `<option value="${v}">${v}</option>`).join('');
        // Seleccionar la más reciente por defecto
        versionSelect.value = data.versions[0];
        versionsLoaded = true;
      } else {
        versionSelect.innerHTML = '<option value="1.21.8">1.21.8</option>';
      }
    }
    DOM.show(modal);
  });
  DOM.on('btn-cancel-new-server', 'click', () => DOM.hide(modal));

  // Estrategia de acceso: al elegir "Personalizado" se muestra el input de puerto
  const portStrategy = DOM.get('new-server-port-strategy');
  const customPort = DOM.get('new-server-port');
  if (portStrategy && customPort) {
    portStrategy.addEventListener('change', () => {
      customPort.style.display = portStrategy.value === 'custom' ? 'block' : 'none';
    });
  }

  DOM.on('btn-create-server', 'click', async () => {
    UIProgress.show('Creando servidor...');

    const name = DOM.get('new-server-name').value;
    const memory = DOM.get('new-server-memory').value;
    const strategy = DOM.get('new-server-port-strategy').value;
    const port = strategy === 'custom' ? DOM.get('new-server-port').value : strategy;
    const version = DOM.get('new-server-version').value;

    const res = await ServerModel.create(name, port, memory, version);
    
    UIProgress.hide();

    if (res && res.success) {
      DOM.hide(modal);
      loadServers();
    }
  });

  await loadServers();

  async function loadServers() {
    const list = DOM.get('servers-list');
    list.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-dim); font-family: var(--font-mono);">Cargando servidores...</td></tr>';
    
    const servers = await ServerModel.getAll();
    if (!servers) return;

    list.innerHTML = '';
    if (servers.length === 0) {
      list.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-dim); font-family: var(--font-mono);">No hay servidores creados.</td></tr>';
      return;
    }

    servers.forEach(server => {
      const st = server.status?.status || 'OFFLINE';
      const isOnline = st === 'ONLINE';
      const isStarting = st === 'STARTING';
      
      let badgeClass = 'offline';
      if (isOnline) badgeClass = 'online';
      if (isStarting) badgeClass = 'starting';

      const card = DOM.create('tr');
      card.innerHTML = `
        <td><strong>${server.name}</strong></td>
        <td>
          <div class="status-badge ${badgeClass}" style="display: inline-flex; width: max-content;">
            <div class="dot"></div>
            <span class="text">${st}</span>
          </div>
        </td>
        <td style="font-family: var(--font-mono); color: var(--text-dim);">${server.id}</td>
        <td style="font-family: var(--font-mono); color: var(--text-dim);">${server.version || '—'}</td>
        <td style="font-family: var(--font-mono);">${server.port}</td>
        <td style="font-family: var(--font-mono);">${server.memory}</td>
        <td style="font-family: var(--font-mono);">${server.status?.players || 0}/${server.status?.maxPlayers || 0}</td>
        <td style="text-align: right;">
          <ui-button variant="blue" id="manage-btn-${server.id}" style="width: auto; display: inline-flex; padding: 6px 12px; font-size: 0.8rem;"><i data-lucide="settings"></i> Administrar</ui-button>
        </td>
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
