import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import '../components/index.js';
import { ServerHeader } from './server-header.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPlaytime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function getDimensionConfig(dim) {
  switch (dim) {
    case 'overworld': return { label: 'Overworld', emoji: '🌳', cls: 'dim-overworld' };
    case 'nether':    return { label: 'Nether',    emoji: '🔥', cls: 'dim-nether' };
    case 'end':       return { label: 'The End',   emoji: '🌌', cls: 'dim-end' };
    default:          return { label: 'Desconocido', emoji: '❓', cls: 'dim-unknown' };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

let skinViewer = null;
const playerCache = {}; // Cache para guardar { skin, avatar } por nombre de jugador


// Exponer la función para que se pueda llamar desde los botones HTML (onclick)
window.showPlayerDetails = function(name, x, y, z, dimension, playtime, isOnline, lastSeen) {
  const modal = DOM.get('player-detail-modal');
  if (!modal) return;
  
  DOM.get('detail-name').textContent = name;
  DOM.get('detail-status').textContent = isOnline ? '🟢 En Línea' : '🔴 Offline';
  DOM.get('detail-status').style.color = isOnline ? 'var(--color-success)' : 'var(--text-dim)';
  
  const cache = playerCache[name] || {};
  const avatarUrl = cache.avatar || `https://mc-heads.net/avatar/${name}/60`;
  const skinUrl = cache.skin || `https://mc-heads.net/skin/${name}`;
  
  DOM.get('detail-avatar').src = avatarUrl;
  DOM.get('detail-playtime').textContent = formatPlaytime(playtime);
  
  const coordsEl = DOM.get('detail-coords');
  const dimEl = DOM.get('detail-dim');
  if (x !== null && x !== undefined && y !== null && z !== null) {
    coordsEl.textContent = `X: ${Math.round(x)}, Y: ${Math.round(y)}, Z: ${Math.round(z)}`;
    const dimCfg = getDimensionConfig(dimension);
    dimEl.textContent = `${dimCfg.emoji} ${dimCfg.label}`;
  } else {
    coordsEl.textContent = 'Desconocido';
    dimEl.textContent = '';
  }
  
  DOM.get('detail-lastseen').textContent = lastSeen ? new Date(lastSeen).toLocaleString() : 'Ahora mismo';
  
  // Destruir visor previo si existe
  if (skinViewer) {
    try { skinViewer.dispose(); } catch (e) { /* ignorar si el visor ya no existe */ }
    skinViewer = null;
    DOM.get('detail-skin-viewer').innerHTML = '';
  }
  
  // Renderizar Skin 3D
  if (window.skinview3d) {
    skinViewer = new window.skinview3d.SkinViewer({
      canvas: document.createElement('canvas'),
      width: 150,
      height: 250,
      skin: skinUrl
    });
    DOM.get('detail-skin-viewer').appendChild(skinViewer.canvas);
    
    // Configurar animación (caminar y rotar suave)
    skinViewer.animation = new window.skinview3d.WalkingAnimation();
    skinViewer.animation.speed = 0.5;
    skinViewer.autoRotate = true;
    skinViewer.autoRotateSpeed = 0.5;
  }
  
  DOM.show(modal);
};

document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar Header en background (no bloquea el registro del listener,
  // así el primer serverStatusUpdate se captura de inmediato)
  ServerHeader.init().catch(() => {});

  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) return;

  // ─── Events from Header ────────────────────────────────────────────────────

  document.addEventListener('serverStatusUpdate', (e) => {
    const statusObj = e.detail;
    updatePlayersUI(statusObj.playersInfo ?? []);
  });

  // ─── Players Logic ─────────────────────────────────────────────────────────
  
  function updatePlayersUI(playersInfo) {
    const list = DOM.get('players-list');
    const empty = DOM.get('players-empty');
    const countBadge = DOM.get('players-count-badge');
    const skeleton = DOM.get('players-skeleton');

    // Primer dato real: reemplazar el skeleton de carga
    if (skeleton) skeleton.style.display = 'none';

    const onlinePlayers = playersInfo.filter(p => p.online);
    countBadge.textContent = onlinePlayers.length;

    if (onlinePlayers.length === 0) {
      empty.style.display = 'flex';
      list.querySelectorAll('.player-row:not(.player-row-skeleton)').forEach(el => el.remove());
      return;
    }

    empty.style.display = 'none';
    const currentNames = new Set(onlinePlayers.map(p => p.name));

    list.querySelectorAll('.player-row:not(.player-row-skeleton)').forEach(el => {
      if (!currentNames.has(el.dataset.name)) el.remove();
    });

    onlinePlayers.forEach(player => {
      const existing = list.querySelector(`.player-row[data-name="${player.name}"]`);
      const dimCfg = getDimensionConfig(player.dimension);
      const coords = (player.x !== null && player.y !== null && player.z !== null)
        ? `${player.x}, ${player.y}, ${player.z}`
        : 'Desconocido';
      const playtime = formatPlaytime(player.playtimeSeconds);
      
      const cache = playerCache[player.name] || {};
      const avatarUrl = cache.avatar || `https://mc-heads.net/avatar/${player.name}/40`;

      if (existing) {
        const avatarImg = existing.querySelector('.player-avatar img');
        if (avatarImg && avatarImg.getAttribute('src') !== avatarUrl) {
          avatarImg.setAttribute('src', avatarUrl);
        }
        const dimEl = existing.querySelector('.player-dim');
        if (dimEl) {
          dimEl.className = `player-dim ${dimCfg.cls}`;
          dimEl.innerHTML = `<span>${dimCfg.emoji}</span> ${dimCfg.label}`;
        }
        const coordEl = existing.querySelector('.player-coords');
        if (coordEl) coordEl.textContent = coords;
        const playtimeEl = existing.querySelector('.player-playtime');
        if (playtimeEl) playtimeEl.textContent = `⏱ ${playtime}`;
      } else {
        const row = document.createElement('div');
        row.className = 'player-row';
        row.dataset.name = player.name;
        row.innerHTML = `
          <div class="player-avatar">
            <img src="${avatarUrl}" alt="${player.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><rect width=%2240%22 height=%2240%22 fill=%22%23475569%22 rx=%228%22/><text x=%2250%25%22 y=%2255%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2218%22>👤</text></svg>'">
            <span class="player-online-dot"></span>
          </div>
          <div class="player-info">
            <span class="player-name">${player.name}</span>
            <span class="player-coords">📍 ${coords}</span>
          </div>
          <div class="player-meta" style="flex: 1; justify-content: flex-end;">
            <span class="player-dim ${dimCfg.cls}"><span>${dimCfg.emoji}</span> ${dimCfg.label}</span>
            <span class="player-playtime" style="min-width: 80px; text-align: right;">⏱ ${playtime}</span>
          </div>
          <div class="player-actions" style="margin-left: 15px;">
            <ui-button variant="secondary" size="sm" onclick="showPlayerDetails('${player.name}', ${player.x}, ${player.y}, ${player.z}, '${player.dimension}', ${player.playtimeSeconds}, true, null)" style="padding: 4px 10px; font-size: 0.75rem;"><i data-lucide="eye" style="width: 14px; height: 14px; margin-right: 4px;"></i> Detalle</ui-button>
          </div>
        `;
        list.appendChild(row);
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // ─── Registry Logic ────────────────────────────────────────────────────────
  
  async function loadRegistry() {
    try {
      // El endpoint está protegido: API.call agrega el token automáticamente.
      const data = await API.call(`/${serverId}/players`, 'GET', null, '/api/server');
      if (data && data.success) {
        data.players.forEach(p => {
          playerCache[p.name] = { skin: p.skin, avatar: p.avatar };
        });
        renderRegistry(data.players);
      }
    } catch (e) {
      console.error("Error loading registry", e);
    }
  }

  function renderRegistry(players) {
    const list = DOM.get('registry-list');
    const empty = DOM.get('registry-empty');
    const badge = DOM.get('registry-count-badge');
    
    badge.textContent = players.length;
    
    if (players.length === 0) {
      empty.style.display = 'flex';
      list.querySelectorAll('.player-row').forEach(el => el.remove());
      return;
    }
    
    empty.style.display = 'none';
    list.querySelectorAll('.player-row').forEach(el => el.remove());
    
    players.forEach(player => {
      const row = document.createElement('div');
      row.className = 'player-row';
      const cache = playerCache[player.name] || {};
      const avatarUrl = cache.avatar || `https://mc-heads.net/avatar/${player.name}/40`;
      const playtime = formatPlaytime(player.playtimeSeconds);
      
      row.innerHTML = `
        <div class="player-avatar">
          <img src="${avatarUrl}" alt="${player.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><rect width=%2240%22 height=%2240%22 fill=%22%23475569%22 rx=%228%22/><text x=%2250%25%22 y=%2255%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2218%22>👤</text></svg>'">
        </div>
        <div class="player-info">
          <span class="player-name">${player.name}</span>
          <span class="player-coords" style="color: var(--text-dim); font-size: 0.75rem;">Última vez: ${new Date(player.lastSeen).toLocaleDateString()}</span>
        </div>
        <div class="player-meta" style="flex: 1; justify-content: flex-end;">
          <span class="player-playtime" style="min-width: 80px; text-align: right;">⏱ ${playtime}</span>
        </div>
        <div class="player-actions" style="margin-left: 15px;">
          <ui-button variant="secondary" size="sm" onclick="showPlayerDetails('${player.name}', null, null, null, null, ${player.playtimeSeconds}, false, '${player.lastSeen}')" style="padding: 4px 10px; font-size: 0.75rem;"><i data-lucide="eye" style="width: 14px; height: 14px; margin-right: 4px;"></i> Detalle</ui-button>
        </div>
      `;
      list.appendChild(row);
    });
    
    if (window.lucide) window.lucide.createIcons();
  }

  // ─── Modal de detalle: abrir/cerrar ─────────────────────────────────────
  const detailModal = DOM.get('player-detail-modal');
  if (detailModal) {
    DOM.on('btn-close-player-detail', 'click', () => DOM.hide(detailModal));
    // Cerrar al hacer click fuera de la caja del modal
    detailModal.addEventListener('click', (e) => {
      if (e.target === detailModal) DOM.hide(detailModal);
    });
  }

  // Load registry initially
  loadRegistry();

});
