import { API } from '../utils/api.js';
import { ServerHeader } from './server-header.js';
import '../utils/Alerts.js';

document.addEventListener('DOMContentLoaded', async () => {
  ServerHeader.init().catch(() => {});

  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');

  if (!serverId) {
    window.location.href = '/dashboard.html';
    return;
  }

  const btnSave = document.getElementById('btn-save');
  const form = document.getElementById('messages-form');
  const btnAddRule = document.getElementById('btn-add-player-rule');
  const rulesContainer = document.getElementById('player-rules-container');
  const noRulesMsg = document.getElementById('no-rules-message');

  let playerRules = [];

  // Función para insertar texto en la posición del cursor de un input
  function insertAtCursor(input, text) {
    if (input.selectionStart || input.selectionStart === '0') {
      const startPos = input.selectionStart;
      const endPos = input.selectionEnd;
      input.value = input.value.substring(0, startPos) + text + input.value.substring(endPos, input.value.length);
      input.selectionStart = startPos + text.length;
      input.selectionEnd = startPos + text.length;
    } else {
      input.value += text;
    }
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Manejador global para los botones de variables
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-insert-var');
    if (btn) {
      const variable = btn.dataset.var;
      let targetInput;
      
      // Si el botón está dentro de las reglas de jugador
      if (btn.dataset.index !== undefined) {
        targetInput = rulesContainer.querySelector(`input[data-index="${btn.dataset.index}"][data-field="message"]`);
      } 
      // Si está en los mensajes globales
      else if (btn.dataset.target) {
        targetInput = document.getElementById(btn.dataset.target);
      }
      
      if (targetInput) {
        insertAtCursor(targetInput, variable);
      }
    }
  });

  function renderPlayerRules() {
    rulesContainer.innerHTML = '';
    if (playerRules.length === 0) {
      noRulesMsg.style.display = 'block';
    } else {
      noRulesMsg.style.display = 'none';
      playerRules.forEach((rule, index) => {
        const ruleEl = document.createElement('div');
        ruleEl.style.cssText = 'background: var(--bg-core); border: 1px solid var(--border-color); border-radius: var(--border-radius); padding: 15px; display: grid; grid-template-columns: 1fr 1fr 2fr auto; gap: 15px; align-items: end;';
        
        ruleEl.innerHTML = `
          <div>
            <label style="display:block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 5px;">Jugador</label>
            <input type="text" list="known-players" class="dimension-input" placeholder="Ej: Steve" value="${rule.playerName || ''}" data-index="${index}" data-field="playerName">
          </div>
          <div>
            <label style="display:block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 5px;">Dimensión</label>
            <select class="dimension-input" data-index="${index}" data-field="dimension" style="padding: 0.85rem; appearance: auto;">
              <option value="*" ${rule.dimension === '*' ? 'selected' : ''}>Todas (*)</option>
              <option value="minecraft:overworld" ${rule.dimension === 'minecraft:overworld' ? 'selected' : ''}>Overworld</option>
              <option value="minecraft:the_nether" ${rule.dimension === 'minecraft:the_nether' ? 'selected' : ''}>Nether</option>
              <option value="minecraft:the_end" ${rule.dimension === 'minecraft:the_end' ? 'selected' : ''}>The End</option>
            </select>
          </div>
          <div>
            <label style="display:block; font-size: 0.85rem; color: var(--text-dim); margin-bottom: 5px;">Mensaje</label>
            <div style="display: flex; gap: 5px; align-items: center;">
              <input type="text" class="dimension-input" placeholder="Ej: {player} murió por: {reason}" value="${rule.message || ''}" data-index="${index}" data-field="message">
              <button type="button" class="btn-insert-var" data-var="{player}" data-index="${index}" title="Insertar {player}" style="background: var(--bg-panel); border: 1px solid var(--border-color); color: var(--text-dim); border-radius: 4px; padding: 0 8px; height: 100%; cursor: pointer;">{p}</button>
              <button type="button" class="btn-insert-var" data-var="{reason}" data-index="${index}" title="Insertar {reason}" style="background: var(--bg-panel); border: 1px solid var(--border-color); color: var(--text-dim); border-radius: 4px; padding: 0 8px; height: 100%; cursor: pointer;">{r}</button>
            </div>
          </div>
          <div style="display: flex; gap: 5px; height: 100%;">
            <button type="button" class="btn btn-success btn-save-rule" data-index="${index}" style="padding: 0.85rem; display: flex; align-items: center; justify-content: center;" title="Guardar fila">
              <i data-lucide="save" style="width:16px;height:16px;"></i>
            </button>
            <button type="button" class="btn btn-danger btn-remove-rule" data-index="${index}" style="padding: 0.85rem; display: flex; align-items: center; justify-content: center;" title="Eliminar regla">
              <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
            </button>
          </div>
        `;
        rulesContainer.appendChild(ruleEl);
      });
      if (window.lucide) lucide.createIcons({ root: rulesContainer });
    }
  }

  rulesContainer.addEventListener('input', (e) => {
    if (e.target.dataset.index !== undefined) {
      const idx = parseInt(e.target.dataset.index, 10);
      const field = e.target.dataset.field;
      playerRules[idx][field] = e.target.value;
      btnSave.removeAttribute('disabled');
    }
  });

  rulesContainer.addEventListener('click', (e) => {
    const btnRemove = e.target.closest('.btn-remove-rule');
    if (btnRemove) {
      const idx = parseInt(btnRemove.dataset.index, 10);
      playerRules.splice(idx, 1);
      renderPlayerRules();
      btnSave.removeAttribute('disabled');
      return;
    }

    const btnSaveRow = e.target.closest('.btn-save-rule');
    if (btnSaveRow) {
      const originalHtml = btnSaveRow.innerHTML;
      btnSaveRow.innerHTML = '<i data-lucide="loader" class="spin" style="width:16px;height:16px;"></i>';
      if (window.lucide) lucide.createIcons({ root: btnSaveRow });
      
      btnSave.click(); // Dispara el guardado global
      
      setTimeout(() => {
        btnSaveRow.innerHTML = '<i data-lucide="check" style="width:16px;height:16px;"></i>';
        if (window.lucide) lucide.createIcons({ root: btnSaveRow });
        setTimeout(() => {
          btnSaveRow.innerHTML = originalHtml;
          if (window.lucide) lucide.createIcons({ root: btnSaveRow });
        }, 1500);
      }, 500);
    }
  });

  btnAddRule.addEventListener('click', () => {
    playerRules.push({ playerName: '', dimension: '*', message: '' });
    renderPlayerRules();
    btnSave.removeAttribute('disabled');
  });

  try {
    // 1. Cargar lista de jugadores para el datalist
    fetch(`/api/server/${serverId}/players`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('mm_token')}` }
    }).then(async res => {
      if (res.ok) {
        const data = await res.json();
        if (data.players) {
          const datalist = document.getElementById('known-players');
          data.players.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            datalist.appendChild(opt);
          });
        }
      }
    }).catch(() => {});

    // 2. Cargar mensajes configurados
    const response = await fetch(`/api/server/${serverId}/death-messages`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('mm_token')}` }
    });
    if (response.ok) {
      const messages = await response.json();
      
      messages.forEach(msg => {
        if (!msg.playerName) {
          // Global message
          const input = form.querySelector(`input[name="${msg.dimension}"]`);
          if (input) {
            input.value = msg.message;
          }
        } else {
          // Player specific rule
          playerRules.push({
            playerName: msg.playerName,
            dimension: msg.dimension,
            message: msg.message
          });
        }
      });
      renderPlayerRules();
    }

    form.addEventListener('input', () => {
      btnSave.removeAttribute('disabled');
    });

    btnSave.addEventListener('click', async () => {
      btnSave.setAttribute('disabled', 'true');
      const originalHtml = btnSave.innerHTML;
      btnSave.innerHTML = '<i data-lucide="loader" class="spin"></i> Guardando...';
      if (window.lucide) lucide.createIcons({ root: btnSave });

      const globalMessages = [
        { dimension: 'minecraft:overworld', message: form.querySelector('[name="minecraft:overworld"]').value },
        { dimension: 'minecraft:the_nether', message: form.querySelector('[name="minecraft:the_nether"]').value },
        { dimension: 'minecraft:the_end', message: form.querySelector('[name="minecraft:the_end"]').value },
        { dimension: '*', message: form.querySelector('[name="*"]').value }
      ].filter(item => item.message.trim() !== '');

      // Combine global and player rules
      const allMessages = [...globalMessages, ...playerRules.filter(r => r.playerName.trim() !== '' && r.message.trim() !== '')];

      try {
        const res = await fetch(`/api/server/${serverId}/death-messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('mm_token')}`
          },
          body: JSON.stringify({ messages: allMessages })
        });

        if (res.ok) {
          window.Toast?.show('Mensajes guardados correctamente', 'success');
        } else {
          throw new Error('Error al guardar los mensajes');
        }
      } catch (err) {
        console.error(err);
        window.Toast?.show('Error al guardar', 'error');
        btnSave.removeAttribute('disabled');
      } finally {
        btnSave.innerHTML = originalHtml;
        if (window.lucide) lucide.createIcons({ root: btnSave });
      }
    });

    if (window.lucide) lucide.createIcons();

  } catch (err) {
    console.error(err);
    window.Toast?.show('Error al cargar la configuración', 'error');
  }
});
