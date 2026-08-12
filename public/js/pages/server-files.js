import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerHeader } from './server-header.js';

document.addEventListener('DOMContentLoaded', async () => {
  ServerHeader.init().catch(() => {});

  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  let currentPath = urlParams.get('path') || '.';
  if (!serverId) return;

  let currentStorage = 'local'; // 'local' | 'r2'
  let currentFiles = [];
  let selectedFiles = new Set();

  const tbody = document.getElementById('fm-tbody');
  const btnUp = document.getElementById('fm-btn-up');
  const breadcrumb = document.getElementById('fm-breadcrumb');
  const checkAll = document.getElementById('fm-check-all');
  const btnDeleteSel = document.getElementById('fm-btn-delete-sel');
  const selCount = document.getElementById('fm-sel-count');
  const footerInfo = document.getElementById('fm-footer-info');

  const btnLocal = document.getElementById('btn-storage-local');
  const btnR2 = document.getElementById('btn-storage-r2');

  const TEXT_EXTS = ['.txt', '.yml', '.yaml', '.json', '.properties', '.toml', '.xml', '.log', '.sh', '.bat', '.cmd', '.js', '.ts', '.css', '.html'];
  
  // ── Storage Toggle ────────────────────────────────────────────────────────
  btnLocal?.addEventListener('click', () => {
    if (currentStorage === 'local') return;
    currentStorage = 'local';
    btnLocal.classList.add('active');
    btnR2.classList.remove('active');
    currentPath = '.';
    loadFiles(currentPath);
  });

  btnR2?.addEventListener('click', () => {
    if (currentStorage === 'r2') return;
    currentStorage = 'r2';
    btnR2.classList.add('active');
    btnLocal.classList.remove('active');
    currentPath = '.';
    loadFiles(currentPath);
  });

  // ── Navegación ─────────────────────────────────────────────────────────────
  btnUp?.addEventListener('click', () => {
    if (currentStorage === 'r2' || currentPath === '.') return;
    const parts = currentPath.split('/');
    parts.pop();
    const parentPath = parts.length === 0 ? '.' : parts.join('/');
    loadFiles(parentPath);
  });

  // ── Selección ──────────────────────────────────────────────────────────────
  function updateSelectionUI() {
    if (!checkAll || !btnDeleteSel || !selCount) return;
    const allCheckboxes = Array.from(tbody.querySelectorAll('.fm-row-check'));
    const allChecked = allCheckboxes.length > 0 && allCheckboxes.every(cb => cb.checked);
    const someChecked = allCheckboxes.some(cb => cb.checked);
    
    checkAll.checked = allChecked;
    checkAll.indeterminate = !allChecked && someChecked;

    if (selectedFiles.size > 0) {
      btnDeleteSel.style.display = 'inline-flex';
      selCount.textContent = selectedFiles.size;
    } else {
      btnDeleteSel.style.display = 'none';
    }
  }

  checkAll?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    selectedFiles.clear();
    const checkboxes = tbody.querySelectorAll('.fm-row-check');
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
      if (isChecked) {
        selectedFiles.add(cb.dataset.file);
        cb.closest('tr')?.classList.add('selected');
      } else {
        cb.closest('tr')?.classList.remove('selected');
      }
    });
    updateSelectionUI();
  });

  btnDeleteSel?.addEventListener('click', async () => {
    if (selectedFiles.size === 0) return;
    if (!confirm(`¿Eliminar los ${selectedFiles.size} archivos seleccionados?`)) return;
    
    const token = localStorage.getItem('token');
    const promises = Array.from(selectedFiles).map(file => {
      return fetch(`/api/server/${serverId}/files`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file })
      });
    });

    try {
      window.Toast?.show('Eliminando archivos...', 'info');
      await Promise.all(promises);
      window.Toast?.show('Archivos eliminados', 'success');
      selectedFiles.clear();
      loadFiles(currentPath);
    } catch(e) {
      window.Toast?.show('Error al eliminar algunos archivos', 'error');
    }
  });

  // ── Render de tabla ────────────────────────────────────────────────────────
  const ICONS = {
    dir: '📁', file: '📄', archive: '📦', config: '⚙️', image: '🖼️', code: '⚡', map: '🌍'
  };

  function getIcon(item) {
    if (item.type === 'dir') return ['world','world_nether','world_the_end'].includes(item.name) ? ICONS.map : ICONS.dir;
    const ext = item.extension?.toLowerCase() || '';
    if (['.zip','.jar','.tar','.gz'].includes(ext)) return ICONS.archive;
    if (['.json','.yml','.yaml','.properties','.toml'].includes(ext)) return ICONS.config;
    if (['.png','.jpg','.jpeg'].includes(ext)) return ICONS.image;
    if (['.sh','.bat','.js','.ts','.py'].includes(ext)) return ICONS.code;
    return ICONS.file;
  }

  function renderTable(items) {
    selectedFiles.clear();
    updateSelectionUI();
    tbody.innerHTML = '';
    
    if (!items || items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="fm-empty-cell"><i data-lucide="folder-open" style="width:32px;height:32px;opacity:0.3;margin-bottom:10px;"></i><br>Carpeta vacía</td></tr>`;
      if (window.lucide) lucide.createIcons();
      footerInfo.textContent = `0 elementos`;
      return;
    }

    let html = '';
    items.forEach(item => {
      // Ignorar carpeta R2 vacia que se lista como object
      if (currentStorage === 'r2' && item.name === '') return;
      
      const isDir = item.type === 'dir';
      const icon = getIcon(item);
      const isEditable = !isDir && currentStorage === 'local' && TEXT_EXTS.includes(item.extension?.toLowerCase() || '');
      const fullPath = item.path || item.name;
      const dateStr = item.modified ? new Date(item.modified).toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '--';

      html += `
        <tr data-type="${item.type}" data-path="${fullPath}" data-name="${item.name}">
          <td class="fm-col-check">
            <input type="checkbox" class="fm-row-check" data-file="${fullPath}">
          </td>
          <td class="fm-col-icon"><span class="fm-icon">${icon}</span></td>
          <td class="fm-col-name"><span class="fm-filename" style="cursor:${isDir ? 'pointer' : 'default'}">${item.name}</span></td>
          <td class="fm-col-size" style="color:var(--text-dim);font-size:0.85rem;">${item.sizeFormatted || '--'}</td>
          <td class="fm-col-date" style="color:var(--text-dim);font-size:0.85rem;">${dateStr}</td>
          <td class="fm-col-actions">
            <div class="fm-actions-row">
              ${isEditable ? `<button class="fm-action-btn fm-btn-edit" title="Editar texto" data-file="${fullPath}"><i data-lucide="edit-3"></i></button>` : ''}
              ${!isDir ? `<button class="fm-action-btn fm-btn-download" title="Descargar" data-file="${fullPath}"><i data-lucide="download"></i></button>` : ''}
              <button class="fm-action-btn fm-btn-delete danger" title="Eliminar" data-file="${fullPath}"><i data-lucide="trash-2"></i></button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    if (window.lucide) lucide.createIcons({ root: tbody });

    footerInfo.textContent = `${items.length} elementos (Ruta: ${currentStorage === 'local' ? currentPath : 'R2/' + serverId})`;

    // Checkboxes click
    tbody.querySelectorAll('.fm-row-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const tr = e.target.closest('tr');
        if (e.target.checked) {
          selectedFiles.add(e.target.dataset.file);
          tr.classList.add('selected');
        } else {
          selectedFiles.delete(e.target.dataset.file);
          tr.classList.remove('selected');
        }
        updateSelectionUI();
      });
    });

    // Name click (navegar si es dir)
    tbody.querySelectorAll('.fm-filename').forEach(el => {
      el.addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        if (tr.dataset.type === 'dir' && currentStorage === 'local') {
          loadFiles(tr.dataset.path);
        }
      });
    });

    // Botones de acción
    tbody.querySelectorAll('.fm-btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openEditor(btn.dataset.file));
    });

    tbody.querySelectorAll('.fm-btn-download').forEach(btn => {
      btn.addEventListener('click', () => downloadFile(btn.dataset.file));
    });

    tbody.querySelectorAll('.fm-btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const file = btn.dataset.file;
        if (!confirm(`¿Eliminar "${file}" permanentemente?`)) return;
        const token = localStorage.getItem('token');
        try {
          const res = await fetch(`/api/server/${serverId}/files`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: file })
          });
          if (!res.ok) throw new Error(await res.text());
          window.Toast?.show(`Eliminado: ${file}`, 'success');
          loadFiles(currentPath);
        } catch(e) {
          window.Toast?.show('Error al eliminar el archivo', 'error');
        }
      });
    });
  }

  function renderBreadcrumb(path) {
    if (currentStorage === 'r2') {
      btnUp.disabled = true;
      breadcrumb.innerHTML = `<span class="fm-bread-item fm-bread-root"><i data-lucide="cloud" style="width:13px;height:13px;"></i> Bucket R2 (${serverId}/)</span>`;
      if (window.lucide) lucide.createIcons({ root: breadcrumb });
      return;
    }

    const parts = path === '.' ? [] : path.split('/');
    btnUp.disabled = parts.length === 0;

    let html = `<span class="fm-bread-item fm-bread-root" data-path="." style="cursor:pointer;"><i data-lucide="server" style="width:13px;height:13px;"></i> Raíz</span>`;
    let accumulated = '';
    parts.forEach((p, i) => {
      accumulated = accumulated ? `${accumulated}/${p}` : p;
      const isLast = i === parts.length - 1;
      html += `<span class="fm-bread-sep">/</span>`;
      html += `<span class="fm-bread-item ${isLast ? 'active' : ''}" data-path="${accumulated}" style="cursor:${isLast ? 'default' : 'pointer'};">${p}</span>`;
    });
    
    breadcrumb.innerHTML = html;
    if (window.lucide) lucide.createIcons({ root: breadcrumb });

    breadcrumb.querySelectorAll('.fm-bread-item:not(.active)').forEach(el => {
      el.addEventListener('click', () => loadFiles(el.dataset.path));
    });
  }

  async function loadFiles(path) {
    currentPath = path;
    
    tbody.innerHTML = `<tr><td colspan="6" class="fm-loading-cell"><div class="fm-loading"><div class="loader-spinner" style="width:24px;height:24px;border-width:3px;margin:0 auto 10px;"></div><span>Cargando...</span></div></td></tr>`;
    renderBreadcrumb(path);

    try {
      const endpoint = currentStorage === 'local' 
        ? `/${serverId}/files?path=${encodeURIComponent(path)}`
        : `/${serverId}/s3/files`;
      
      const data = await API.call(endpoint, 'GET', null, '/api/server', true);
      
      if (!data) throw new Error("No data");
      if (currentStorage === 'local' && data.serverExists === false) {
        tbody.innerHTML = `<tr><td colspan="6" class="fm-empty-cell">El servidor no tiene archivos en disco aún.<br><small>Inícialo para generarlos.</small></td></tr>`;
        return;
      }

      currentFiles = data.items || [];
      // Si es local, ordenar carpetas primero
      if (currentStorage === 'local') {
        currentFiles.sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1;
          if (a.type !== 'dir' && b.type === 'dir') return 1;
          return a.name.localeCompare(b.name);
        });
      }
      
      renderTable(currentFiles);

    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="6" class="fm-empty-cell" style="color:var(--color-danger);">Error al cargar los archivos.</td></tr>`;
    }
  }

  // ── Editor ─────────────────────────────────────────────────────────────────
  const overlay = document.getElementById('fm-editor-overlay');
  const edFile = document.getElementById('fm-editor-filename');
  const edStatus = document.getElementById('fm-editor-status');
  const edContent = document.getElementById('fm-editor-content');
  const edSave = document.getElementById('fm-editor-save');
  const edClose = document.getElementById('fm-editor-close');
  let edCurrentPath = null;

  async function openEditor(path) {
    edCurrentPath = path;
    edFile.textContent = path.split('/').pop();
    edContent.value = 'Cargando...';
    edContent.disabled = true;
    edStatus.textContent = '';
    overlay.style.display = 'flex';

    try {
      const data = await API.call(`/${serverId}/files/read?path=${encodeURIComponent(path)}`, 'GET', null, '/api/server', true);
      if (data && data.content !== undefined) {
        edContent.value = data.content;
        edContent.disabled = false;
        edContent.focus();
      } else {
        throw new Error("No content");
      }
    } catch(e) {
      edContent.value = 'Error al cargar el archivo.';
      edStatus.textContent = 'Error';
      edStatus.style.color = 'var(--color-danger)';
    }
  }

  edClose?.addEventListener('click', () => {
    overlay.style.display = 'none';
    edCurrentPath = null;
  });

  edSave?.addEventListener('click', async () => {
    if (!edCurrentPath) return;
    edStatus.textContent = 'Guardando...';
    edStatus.style.color = 'var(--text-dim)';
    
    try {
      await API.call(`/${serverId}/files/write`, 'POST', {
        path: edCurrentPath,
        content: edContent.value
      }, '/api/server');
      edStatus.textContent = 'Guardado';
      edStatus.style.color = 'var(--color-success)';
      setTimeout(() => { if(edStatus.textContent === 'Guardado') edStatus.textContent = ''; }, 3000);
    } catch(e) {
      edStatus.textContent = 'Error al guardar';
      edStatus.style.color = 'var(--color-danger)';
    }
  });

  // Ctrl+S en el editor
  edContent?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      edSave.click();
    }
  });

  // ── Descargas ──────────────────────────────────────────────────────────────
  async function downloadFile(path) {
    const filename = path.split('/').pop();
    window.Toast?.show(`Descargando ${filename}...`, 'info');
    try {
      const token = localStorage.getItem('token');
      // Usamos el endpoint de /download para R2 también (si está implementado), pero el backend actual:
      // /api/server/:id/files/download?path=...
      let url = `/api/server/${serverId}/files/download?path=${encodeURIComponent(path)}`;
      if (currentStorage === 'r2') {
        url = `/api/server/${serverId}/s3/files/${encodeURIComponent(path)}`; // Asumiendo que S3 expone descargas directas? Si no, fallará
      }
      
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) throw new Error("Error en descarga");
      
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch(e) {
      window.Toast?.show('Error al descargar el archivo', 'error');
    }
  }

  // Inicializar
  loadFiles(currentPath);
});
