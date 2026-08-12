import { API } from '../utils/api.js';

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');

  if (!serverId) {
    window.location.href = '/dashboard.html';
    return;
  }

  const serverNameEl = document.getElementById('current-server-name');
  const serverInfoEl = document.getElementById('current-server-info');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');

  const form = document.getElementById('settings-form');
  const loader = document.getElementById('settings-loading');
  const saveBtn = document.getElementById('btn-save-settings');

  // Load server status (just for header)
  async function loadServerStatus() {
    try {
      const statusRes = await API.call(`/${serverId}/status`, 'GET', null, '/api/server');
      if (!statusRes) throw new Error('Servidor no encontrado');
      
      const serverRes = await API.call('/', 'GET', null, '/api/server');
      const server = serverRes?.servers?.find(s => s.id == serverId);

      if (server) {
        serverNameEl.textContent = server.name;
        serverInfoEl.textContent = `${server.memory} | Puerto: ${server.port}`;
      } else {
        serverNameEl.textContent = 'Servidor ' + serverId;
      }
      
      statusBadge.className = `status-badge ${statusRes.status}`;
      statusText.textContent = {
        'offline': 'Apagado',
        'starting': 'Iniciando...',
        'online': 'En línea',
        'stopping': 'Deteniendo...'
      }[statusRes.status] || statusRes.status;
      
    } catch (e) {
      console.error('Error cargando estado:', e);
      serverNameEl.textContent = 'Error';
      serverInfoEl.textContent = 'No se pudo cargar el servidor';
    }
  }

  // Load properties
  async function loadProperties() {
    try {
      const res = await API.call(`/${serverId}/properties`, 'GET', null, '/api/server');
      if (!res.properties) return;

      const props = res.properties;
      
      // Mapear props a inputs
      const elements = form.elements;
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.name && props[el.name] !== undefined) {
          el.value = props[el.name];
        }
      }

      loader.style.display = 'none';
      form.style.display = 'block';
    } catch (e) {
      console.error('Error loading properties:', e);
      Toast.show('Error al cargar propiedades del servidor.', 'error');
    }
  }

  // Save properties
  saveBtn.addEventListener('click', async () => {
    const updates = {};
    const elements = form.elements;
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (el.name) {
        updates[el.name] = el.value;
      }
    }

    try {
      saveBtn.disabled = true;
      const originalText = saveBtn.innerHTML;
      saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin-icon" style="width:16px;height:16px;"></i> Guardando...';
      if (window.lucide) window.lucide.createIcons();

      await API.call(`/${serverId}/properties`, 'PUT', { properties: updates }, '/api/server');

      Toast.show('Propiedades guardadas correctamente. Reinicia el servidor para aplicar cambios.', 'success');
      
      saveBtn.innerHTML = originalText;
      saveBtn.disabled = false;
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.error('Error saving properties:', e);
      Toast.show('Error al guardar las propiedades.', 'error');
      saveBtn.disabled = false;
    }
  });

  await loadServerStatus();
  await loadProperties();
});
