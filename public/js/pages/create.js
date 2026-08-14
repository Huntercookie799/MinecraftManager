import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerModel } from '../models/Server.js';
import '../components/index.js';
import { UIProgress } from '../components/UIProgress.js';

const TOTAL_STEPS = 3;

const SOFTWARE_HINTS = {
  purpur: 'Soporta plugins (Bukkit/Spigot/Paper). La opción más estable para survival, minijuegos y redes de servidores.',
  fabric: 'Soporta mods ligeros y modernos mediante Fabric API. Ideal para modpacks actuales.',
  forge: 'Soporta mods clásicos y pesados. La primera instalación descarga el instalador y puede tardar varios minutos.',
  bedrock: 'Servidor nativo de Bedrock, permite jugadores de Minecraft PE / Windows 10.'
};

const VERSION_HINTS = {
  purpur: 'Versiones publicadas por la API de Purpur (compatibles con Paper/Spigot).',
  fabric: 'Versiones estables soportadas por Fabric. Cada una descarga su loader e installer al iniciar.',
  forge: 'Versiones con build recomendada publicada por Forge. Requiere Java según la versión.',
  bedrock: 'Bedrock siempre usa la última versión disponible; no requiere elegir.'
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!API.token) {
    API.logout();
    return;
  }

  // ─── Referencias ───────────────────────────────────────────────────
  const track = DOM.get('wizard-track');
  const backBtn = DOM.get('btn-wizard-back');
  const nextBtn = DOM.get('btn-wizard-next');
  const versionSelect = DOM.get('new-server-version');
  const versionHint = DOM.get('version-hint');
  const softwareHint = DOM.get('software-hint');
  const customPort = DOM.get('new-server-port');
  const motorCards = document.querySelectorAll('.motor-card');
  const strategyCards = document.querySelectorAll('.strategy-card');

  let currentStep = 0;
  const state = {
    software: 'purpur',
    strategy: '',
    version: '' // versión pre-seleccionada (ej. desde pendingCompatInstall)
  };
  const versionsCache = {}; // software -> string[]

  // ─── Navegación del wizard ─────────────────────────────────────────
  function goToStep(step) {
    currentStep = Math.max(0, Math.min(TOTAL_STEPS - 1, step));
    track.style.transform = `translateX(-${currentStep * 100}%)`;

    document.querySelectorAll('.wizard-step').forEach((el, i) => {
      el.classList.toggle('active', i === currentStep);
      el.classList.toggle('done', i < currentStep);
    });
    document.querySelectorAll('.wizard-step-line').forEach((el, i) => {
      el.classList.toggle('done', i < currentStep);
    });

    backBtn.style.visibility = currentStep === 0 ? 'hidden' : 'visible';

    const isLast = currentStep === TOTAL_STEPS - 1;
    const btn = nextBtn.querySelector('button');
    btn.innerHTML = isLast
      ? '<i data-lucide="plus"></i> Crear Servidor'
      : 'Siguiente <i data-lucide="arrow-right"></i>';

    if (window.lucide) window.lucide.createIcons();
  }

  function validateStep(step) {
    if (step === 0) {
      const name = DOM.get('new-server-name').value.trim();
      if (!name) {
        window.Toast?.show('Ingresa un nombre para el servidor', 'error');
        return false;
      }
    }
    if (step === 1 && state.software !== 'bedrock' && !versionSelect.value) {
      window.Toast?.show('Selecciona una versión de Minecraft', 'error');
      return false;
    }
    return true;
  }

  backBtn.addEventListener('click', () => goToStep(currentStep - 1));
  nextBtn.addEventListener('click', () => {
    if (currentStep < TOTAL_STEPS - 1) {
      if (!validateStep(currentStep)) return;
      goToStep(currentStep + 1);
    } else {
      createServer();
    }
  });

  // Clic en los indicadores de pasos ya completados para volver atrás
  document.querySelectorAll('.wizard-step').forEach((el, i) => {
    el.addEventListener('click', () => {
      if (i < currentStep) goToStep(i);
    });
  });

  // ─── Versiones según el motor ──────────────────────────────────────
  async function loadVersions(software) {
    versionSelect.disabled = true;
    versionHint.textContent = VERSION_HINTS[software] || '';

    if (software === 'bedrock') {
      versionSelect.innerHTML = '<option value="">Última versión (automática)</option>';
      versionSelect.value = '';
      state.version = '';
      return;
    }

    versionSelect.innerHTML = '<option value="">Cargando versiones...</option>';

    let list = versionsCache[software];
    if (!list) {
      try {
        const data = await API.call(`/versions/${software}`);
        list = (data && Array.isArray(data.versions) && data.versions.length > 0) ? data.versions : null;
        if (list) versionsCache[software] = list;
      } catch (e) {
        list = null;
      }
    }

    if (!list) {
      versionSelect.innerHTML = '<option value="1.21.8">1.21.8</option>';
      versionSelect.value = '1.21.8';
      versionSelect.disabled = false;
      return;
    }

    versionSelect.innerHTML = list.map(v => `<option value="${v}">${v}</option>`).join('');
    versionSelect.disabled = false;

    // Respetar una versión pre-seleccionada (ej. mundo compatible)
    if (state.version && list.includes(state.version)) {
      versionSelect.value = state.version;
    } else if (state.version) {
      const major = state.version.split('.').slice(0, 2).join('.');
      const option = Array.from(versionSelect.options).find(o => o.value.startsWith(major));
      if (option) versionSelect.value = option.value;
      else window.Toast?.show(`Advertencia: No se encontró la versión exacta ${state.version}. Ajustala manualmente.`, 'warning');
    } else {
      versionSelect.value = list[0];
    }
  }

  // ─── Motor (radio buttons) ─────────────────────────────────────────
  function selectMotor(software) {
    state.software = software;
    motorCards.forEach(card => card.classList.toggle('selected', card.dataset.software === software));
    softwareHint.textContent = SOFTWARE_HINTS[software] || '';
    loadVersions(software);
  }

  motorCards.forEach(card => {
    card.addEventListener('click', () => selectMotor(card.dataset.software));
  });

  // ─── Estrategia de acceso (radio buttons) ──────────────────────────
  function selectStrategy(value) {
    state.strategy = value;
    strategyCards.forEach(card => card.classList.toggle('selected', card.dataset.value === value));
    customPort.style.display = value === 'custom' ? 'block' : 'none';
  }

  strategyCards.forEach(card => {
    card.addEventListener('click', () => selectStrategy(card.dataset.value));
  });

  // ─── Pre-llenar desde sessionStorage si existe ─────────────────────
  const pendingStr = sessionStorage.getItem('pendingCompatInstall');
  let pendingCompatInstall = null;
  if (pendingStr) {
    try {
      pendingCompatInstall = JSON.parse(pendingStr);

      DOM.get('new-server-name').value = 'Servidor_' + (pendingCompatInstall.worldName.replace(/[^a-zA-Z0-9]/g, ''));

      const loader = pendingCompatInstall.loader;
      const software = loader === 'fabric' ? 'fabric' : loader === 'forge' ? 'forge' : 'purpur';
      state.version = pendingCompatInstall.version || '';

      selectMotor(software);
    } catch (e) {
      console.error(e);
    }
    // Borrar de storage inmediatamente para evitar loops si el usuario refresca
    sessionStorage.removeItem('pendingCompatInstall');
  } else {
    selectMotor('purpur');
  }

  // Estado inicial
  selectStrategy('');
  goToStep(0);

  DOM.on('btn-back-dashboard', 'click', () => {
    window.location.href = '/dashboard.html';
  });

  // ─── Creación ──────────────────────────────────────────────────────
  async function createServer() {
    const name = DOM.get('new-server-name').value.trim();
    if (!name) {
      goToStep(0);
      window.Toast?.show('Ingresa un nombre para el servidor', 'error');
      return;
    }
    if (state.software !== 'bedrock' && !versionSelect.value) {
      goToStep(1);
      window.Toast?.show('Selecciona una versión de Minecraft', 'error');
      return;
    }

    UIProgress.show('Creando servidor...');

    const memory = DOM.get('new-server-memory').value.trim() || '2G';
    const softwareType = state.software;
    const version = softwareType === 'bedrock' ? '' : versionSelect.value;
    const strategy = state.strategy;
    const port = strategy === 'custom' ? DOM.get('new-server-port').value : (strategy || undefined);
    const hostname = DOM.get('new-server-hostname')?.value.trim() || undefined;

    try {
      const res = await ServerModel.create(name, port, memory, version, hostname, softwareType);

      if (res && res.success) {
        if (pendingCompatInstall) {
          await installCompatWorld(res.server.id, pendingCompatInstall);
        }
        window.location.href = '/dashboard.html';
      }
    } catch (e) {
      window.Toast?.show(e.message, 'error');
    } finally {
      UIProgress.hide();
    }
  }

  async function installCompatWorld(serverId, data) {
    UIProgress.show('Instalando mundo en el servidor...');
    try {
      if (data.tempPath) {
        // Es un .zip ya analizado
        const res = await API.call('/install-world', 'POST', {
          serverId: serverId,
          tempPath: data.tempPath,
          worldName: data.worldName
        }, '/api/utils');
        if (res && res.success) {
          window.Toast?.show('Mundo instalado exitosamente', 'success');
        }
      } else if (data.modpack) {
        // Es un modpack, hay que usar el endpoint de creacion de mundos del server
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
        } else if (res && res.error) {
          window.Toast?.show(res.error, 'error');
        }
      }
    } catch (e) {
      window.Toast?.show('Error al instalar mundo compatible', 'error');
    }
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
});
