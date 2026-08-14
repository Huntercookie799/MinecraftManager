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

  DOM.on('btn-cancel-compatibility', 'click', () => {
    window.location.href = '/dashboard.html';
  });

  DOM.on('btn-back-dashboard', 'click', () => {
    window.location.href = '/dashboard.html';
  });

  let currentCompatFile = null;
  let currentCompatModpack = null;
  let compatAnalyzedData = null;

  DOM.on('compat-tab-zip', 'click', () => {
    DOM.get('compat-tab-zip').setAttribute('variant', 'secondary');
    DOM.get('compat-tab-modpack').setAttribute('variant', 'ghost');
    DOM.get('compat-content-zip').style.display = 'block';
    DOM.get('compat-content-modpack').style.display = 'none';
  });

  DOM.on('compat-tab-modpack', 'click', () => {
    DOM.get('compat-tab-modpack').setAttribute('variant', 'secondary');
    DOM.get('compat-tab-zip').setAttribute('variant', 'ghost');
    DOM.get('compat-content-modpack').style.display = 'block';
    DOM.get('compat-content-zip').style.display = 'none';
  });

  DOM.on('compat-file', 'change', (e) => {
    currentCompatFile = e.target.files[0];
    currentCompatModpack = null;
    DOM.get('compat-results-area').style.display = 'none';
  });

  DOM.on('btn-execute-compat-modpack-search', 'click', async () => {
    const query = DOM.get('compat-modpack-search-input').value.trim();
    if (!query) return;
    
    const resultsDiv = DOM.get('compat-modpack-search-results');
    const statusDiv = DOM.get('compat-modpack-search-status');
    resultsDiv.innerHTML = '';
    statusDiv.style.display = 'block';
    statusDiv.textContent = 'Buscando modpacks...';

    const res = await API.call(`/addons/search?q=${encodeURIComponent(query)}&limit=10&type=modpack`, 'GET', null, '/api/utils');
    if (!res || !res.items || res.items.length === 0) {
      statusDiv.textContent = 'No se encontraron modpacks.';
      return;
    }
    statusDiv.style.display = 'none';

    res.items.forEach(item => {
      const div = DOM.create('div');
      div.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px; border:1px solid var(--border-color); border-radius:var(--border-radius); cursor:pointer; background:var(--bg-panel);';
      div.innerHTML = `
        <img src="${item.iconUrl || '/images/default-icon.png'}" style="width:40px;height:40px;border-radius:4px;object-fit:cover;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.name}</div>
          <div style="font-size:0.75rem; color:var(--text-dim);">Versiones: ${item.versions?.slice(0,3).join(', ')}${item.versions?.length > 3 ? '...' : ''}</div>
        </div>
      `;
      div.onclick = () => {
        // Seleccionado
        Array.from(resultsDiv.children).forEach(c => c.style.borderColor = 'var(--border-color)');
        div.style.borderColor = 'var(--primary)';
        currentCompatModpack = item;
        currentCompatFile = null;
        DOM.get('compat-results-area').style.display = 'none';
      };
      resultsDiv.appendChild(div);
    });
  });

  DOM.on('btn-analyze-compatibility', 'click', async () => {
    if (!currentCompatFile && !currentCompatModpack) {
      window.Toast?.show('Selecciona un archivo .zip o un modpack primero', 'warning');
      return;
    }

    UIProgress.show('Analizando compatibilidad...');
    let version = null;
    let loader = null;
    let tempPath = null;
    let worldName = null;

    try {
      if (currentCompatFile) {
        worldName = currentCompatFile.name.replace('.zip', '');
        const formData = new FormData();
        formData.append('file', currentCompatFile);
        const res = await fetch('/api/utils/analyze-world', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${API.token}` },
          body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al analizar el .zip');
        version = data.version || '1.21';
        loader = data.loader || 'purpur';
        tempPath = data.tempPath;
      } else if (currentCompatModpack) {
        worldName = currentCompatModpack.name;
        version = currentCompatModpack.versions?.[0]; 
        if (!version) throw new Error('El modpack no especifica versiones de Minecraft');
        
        loader = 'forge'; 
      }

      compatAnalyzedData = { version, loader, tempPath, worldName, modpack: currentCompatModpack };
      
      DOM.get('compat-results-info').innerHTML = `
        <strong>Mundo:</strong> ${worldName} <br>
        <strong>Versión requerida:</strong> ${version} <br>
        <strong>Motor requerido:</strong> ${loader.toUpperCase()}
      `;

      const servers = await ServerModel.getAll();
      const compatibleServers = servers.filter(s => {
        const sLoader = (s.softwareType === 'paper' || s.softwareType === 'purpur') ? 'purpur' : s.softwareType;
        const reqLoader = (loader === 'paper' || loader === 'purpur') ? 'purpur' : loader;
        const sMajor = s.version?.split('.').slice(0,2).join('.') || '';
        const rMajor = version?.split('.').slice(0,2).join('.') || '';
        return sLoader === reqLoader && sMajor === rMajor;
      });

      const matchingDiv = DOM.get('compat-matching-servers');
      matchingDiv.innerHTML = '';
      if (compatibleServers.length > 0) {
        compatibleServers.forEach(s => {
          const div = DOM.create('div');
          div.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px; border:1px solid var(--border-color); border-radius:var(--border-radius); background:var(--bg-core);';
          div.innerHTML = `
            <div><strong>${s.name}</strong> <span style="color:var(--text-dim);font-size:0.8rem;">(${s.version} ${s.softwareType})</span></div>
            <ui-button variant="primary" style="padding:4px 8px; font-size:0.8rem;" id="btn-install-compat-${s.id}">Instalar aquí</ui-button>
          `;
          matchingDiv.appendChild(div);
          
          DOM.on(`btn-install-compat-${s.id}`, 'click', async () => {
            await installCompatWorld(s.id, compatAnalyzedData);
          });
        });
      } else {
        matchingDiv.innerHTML = '<div style="color:var(--color-warning); font-size:0.85rem;">No hay servidores compatibles con este mundo. Crea uno nuevo abajo.</div>';
      }

      DOM.get('compat-results-area').style.display = 'block';
    } catch (e) {
      window.Toast?.show(e.message, 'error');
    } finally {
      UIProgress.hide();
    }
  });

  DOM.on('btn-create-compatible-server', 'click', async () => {
    sessionStorage.setItem('pendingCompatInstall', JSON.stringify(compatAnalyzedData));
    window.location.href = '/create.html';
  });

  async function installCompatWorld(serverId, data) {
    UIProgress.show('Instalando mundo en el servidor...');
    try {
      if (data.tempPath) {
        const res = await API.call('/install-world', 'POST', {
          serverId: serverId,
          tempPath: data.tempPath,
          worldName: data.worldName
        }, '/api/utils');
        if (res && res.success) {
          window.Toast?.show('Mundo instalado exitosamente', 'success');
          setTimeout(() => window.location.href = '/dashboard.html', 1500);
        }
      } else if (data.modpack) {
        const body = {
          name: data.worldName,
          allowMods: true,
          allowPlugins: true,
          modpackId: data.modpack.id,
          modpackSource: data.modpack.source
        };
        const res = await API.call('/', 'POST', body, `/api/server/${serverId}/worlds`);
        if (res && !res.error) {
          window.Toast?.show('Mundo y Modpack instalados', 'success');
          setTimeout(() => window.location.href = '/dashboard.html', 1500);
        } else if (res && res.error) {
           window.Toast?.show(res.error, 'error');
        }
      }
    } catch (e) {
      window.Toast?.show('Error al instalar', 'error');
    } finally {
      UIProgress.hide();
    }
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
});
