import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) { window.location.href = '/dashboard.html'; return; }

  async function loadHeader() {
    try {
      const [statusRes, listRes] = await Promise.all([
        API.call(`/${serverId}/status`, 'GET', null, '/api/server'),
        API.call('/', 'GET', null, '/api/server'),
      ]);
      const server = listRes?.servers?.find(s => s.id == serverId);
      if (server) {
        document.getElementById('current-server-name').textContent = server.name;
        document.getElementById('current-server-info').textContent = `${server.memory} | Puerto: ${server.port}`;
        // Pre-fill form
        const nameInput = document.getElementById('edit-server-name');
        if (nameInput) (nameInput.querySelector('input') ?? nameInput).value = server.name ?? '';
        const colorInput = document.getElementById('edit-server-color');
        const colorHex = document.getElementById('edit-server-color-hex');
        if (colorInput && server.color) {
          colorInput.value = server.color;
          if (colorHex) colorHex.textContent = server.color;
        }
      }
      const badge = document.getElementById('status-badge');
      const text = document.getElementById('status-text');
      if (badge && statusRes) {
        badge.className = `status-badge ${statusRes.status}`;
        text.textContent = { offline: 'Apagado', starting: 'Iniciando...', online: 'En línea', stopping: 'Deteniendo...' }[statusRes.status] ?? statusRes.status;
      }
    } catch (e) { console.error('Header error:', e); }
  }

  // Color picker sync
  document.getElementById('edit-server-color')?.addEventListener('input', (e) => {
    const hex = document.getElementById('edit-server-color-hex');
    if (hex) hex.textContent = e.target.value;
  });

  // Avatar upload
  const avatarBtn = document.getElementById('btn-edit-avatar');
  const avatarInput = document.getElementById('edit-server-avatar');
  const avatarPreviewImg = document.getElementById('edit-avatar-preview-img');
  const avatarPlaceholder = document.getElementById('edit-avatar-placeholder-icon');
  avatarBtn?.addEventListener('click', () => {
    const inp = avatarInput?.querySelector('input[type="file"]') ?? avatarInput;
    inp?.click();
  });
  avatarInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file && avatarPreviewImg) {
      avatarPreviewImg.src = URL.createObjectURL(file);
      avatarPreviewImg.style.display = 'block';
      if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
    }
  });

  // Icon upload
  const iconBtn = document.getElementById('btn-edit-icon');
  const iconInput = document.getElementById('edit-server-icon');
  const iconPreviewImg = document.getElementById('edit-icon-preview-img');
  const iconPlaceholder = document.getElementById('edit-icon-placeholder-icon');
  iconBtn?.addEventListener('click', () => {
    const inp = iconInput?.querySelector('input[type="file"]') ?? iconInput;
    inp?.click();
  });
  iconInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file && iconPreviewImg) {
      iconPreviewImg.src = URL.createObjectURL(file);
      iconPreviewImg.style.display = 'block';
      if (iconPlaceholder) iconPlaceholder.style.display = 'none';
      const removeBtn = document.getElementById('btn-remove-icon');
      if (removeBtn) removeBtn.style.display = 'inline-flex';
    }
  });
  document.getElementById('btn-remove-icon')?.addEventListener('click', () => {
    if (iconPreviewImg) { iconPreviewImg.src = ''; iconPreviewImg.style.display = 'none'; }
    if (iconPlaceholder) iconPlaceholder.style.display = '';
    document.getElementById('btn-remove-icon').style.display = 'none';
  });

  // MOTD preview
  const motdTextarea = document.getElementById('edit-server-motd');
  const motdPreview = document.getElementById('motd-preview');
  function updateMotdPreview() {
    if (!motdTextarea || !motdPreview) return;
    const colorMap = { '0':'#000','1':'#00A','2':'#0A0','3':'#0AA','4':'#A00','5':'#A0A','6':'#FA0','7':'#AAA','8':'#555','9':'#55F','a':'#5F5','b':'#5FF','c':'#F55','d':'#F5F','e':'#FF5','f':'#FFF' };
    let html = motdTextarea.value.replace(/\n/g, '<br>');
    html = html.replace(/§([0-9a-fklmnor])/gi, (_, code) => {
      if (colorMap[code.toLowerCase()]) return `<span style="color:${colorMap[code.toLowerCase()]}">`;
      if (code === 'l') return '<strong>'; if (code === 'n') return '<u>'; if (code === 'r') return '</span></strong></u>';
      return '';
    });
    motdPreview.innerHTML = html;
  }
  motdTextarea?.addEventListener('input', updateMotdPreview);

  // MOTD Tools
  const btnMotdTemplates = document.getElementById('btn-motd-templates');
  const modalMotdTemplates = document.getElementById('modal-motd-templates');
  const btnCloseTemplates = document.getElementById('btn-close-templates');

  btnMotdTemplates?.addEventListener('click', () => {
    DOM.show(modalMotdTemplates);
  });
  btnCloseTemplates?.addEventListener('click', () => {
    DOM.hide(modalMotdTemplates);
  });

  document.querySelectorAll('.btn-use-template').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const template = e.target.closest('.motd-template-item')?.dataset.template;
      if (template && motdTextarea) {
        motdTextarea.value = template.replace(/\\n/g, '\n');
        updateMotdPreview();
        DOM.hide(modalMotdTemplates);
      }
    });
  });

  document.querySelectorAll('.motd-tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const code = e.currentTarget.dataset.code;
      if (!code || !motdTextarea) return;
      
      const start = motdTextarea.selectionStart;
      const end = motdTextarea.selectionEnd;
      const val = motdTextarea.value;
      
      if (start !== end) {
        // Hay texto seleccionado, lo envolvemos con el código y un reset
        const selected = val.substring(start, end);
        const replacement = code + selected + '§r';
        motdTextarea.value = val.substring(0, start) + replacement + val.substring(end);
        // Dejamos el cursor después del texto insertado
        motdTextarea.selectionStart = motdTextarea.selectionEnd = start + replacement.length;
      } else {
        // No hay selección, insertamos normalmente
        motdTextarea.value = val.substring(0, start) + code + val.substring(end);
        motdTextarea.selectionStart = motdTextarea.selectionEnd = start + code.length;
      }
      
      motdTextarea.focus();
      updateMotdPreview();
    });
  });

  // Skin install
  document.getElementById('btn-install-skinrestorer')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('install-sr-status');
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Instalando...'; }
    try {
      await API.call(`/${serverId}/install-skinrestorer`, 'POST', {}, '/api/server');
      if (statusEl) statusEl.textContent = '✓ SkinRestorer instalado';
      window.Toast?.show('SkinRestorer instalado correctamente', 'success');
    } catch (e) {
      if (statusEl) statusEl.textContent = '✗ Error al instalar';
      window.Toast?.show('Error al instalar SkinRestorer', 'error');
    }
  });

  // Skin upload
  document.getElementById('btn-skin-submit')?.addEventListener('click', async () => {
    const usernameEl = document.getElementById('skin-username');
    const fileEl = document.getElementById('skin-file');
    const statusEl = document.getElementById('skin-status');
    const username = (usernameEl?.querySelector('input') ?? usernameEl)?.value?.trim();
    const file = fileEl?.querySelector('input[type="file"]')?.files?.[0] ?? fileEl?.files?.[0];
    if (!username || !file) { window.Toast?.show('Completa el nombre y el archivo', 'warning'); return; }
    const formData = new FormData();
    formData.append('username', username);
    formData.append('skin', file);
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Aplicando skin...'; }
    try {
      const res = await fetch(`/api/server/${serverId}/skins`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('mm_token')}` },
        body: formData,
      });
      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = errorText;
        try {
          const json = JSON.parse(errorText);
          if (json.error) errorMsg = json.error;
        } catch (err) {}
        throw new Error(errorMsg);
      }
      if (statusEl) statusEl.textContent = '✓ Skin aplicada';
      window.Toast?.show('Skin aplicada correctamente', 'success');
    } catch (e) {
      if (statusEl) statusEl.textContent = '✗ Error: ' + e.message;
      window.Toast?.show('Error al aplicar la skin', 'error');
    }
  });

  // Save
  document.getElementById('btn-save-server-settings')?.addEventListener('click', async () => {
    const nameEl = document.getElementById('edit-server-name');
    const name = (nameEl?.querySelector('input') ?? nameEl)?.value?.trim();
    const color = document.getElementById('edit-server-color')?.value;
    const syncS3 = document.getElementById('edit-sync-s3')?.checked;
    const motd = document.getElementById('edit-server-motd')?.value;

    const formData = new FormData();
    formData.append('name', name ?? '');
    formData.append('accentColor', color ?? '');
    formData.append('syncS3', syncS3 ? 'true' : 'false');
    formData.append('motd', motd ?? '');

    const avatarFile = avatarInput?.querySelector('input[type="file"]')?.files?.[0];
    if (avatarFile) formData.append('avatar', avatarFile);
    const iconFile = iconInput?.querySelector('input[type="file"]')?.files?.[0];
    if (iconFile) formData.append('icon', iconFile);

    try {
      const res = await fetch(`/api/server/${serverId}/settings`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('mm_token')}` },
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      window.Toast?.show('Cambios guardados correctamente', 'success');
    } catch (e) { window.Toast?.show('Error al guardar cambios', 'error'); }
  });

  // Delete server
  document.getElementById('btn-delete-server')?.addEventListener('click', async () => {
    if (!confirm('¿Estás seguro de que quieres eliminar este servidor? Esta acción es irreversible.')) return;
    try {
      await API.call(`/${serverId}`, 'DELETE', null, '/api/server');
      window.Toast?.show('Servidor eliminado', 'success');
      setTimeout(() => window.location.href = '/dashboard.html', 1000);
    } catch (e) { window.Toast?.show('Error al eliminar servidor', 'error'); }
  });

  await loadHeader();
  updateMotdPreview();
});
