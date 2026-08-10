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

document.addEventListener('DOMContentLoaded', async () => {
  await ServerHeader.init();

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
      const skinUrl = `https://mc-heads.net/avatar/${player.name}/40`;

      if (existing) {
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
            <img src="${skinUrl}" alt="${player.name}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><rect width=%2240%22 height=%2240%22 fill=%22%23475569%22 rx=%228%22/><text x=%2250%25%22 y=%2255%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2218%22>👤</text></svg>'">
            <span class="player-online-dot"></span>
          </div>
          <div class="player-info">
            <span class="player-name">${player.name}</span>
            <span class="player-coords">📍 ${coords}</span>
          </div>
          <div class="player-meta">
            <span class="player-dim ${dimCfg.cls}"><span>${dimCfg.emoji}</span> ${dimCfg.label}</span>
            <span class="player-playtime">⏱ ${playtime}</span>
          </div>
        `;
        list.appendChild(row);
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

});
