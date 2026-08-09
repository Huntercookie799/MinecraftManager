import { API } from '../utils/api.js';
import { DOM } from '../utils/dom.js';
import { ServerHeader } from './server-header.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar Header
  await ServerHeader.init();

  const urlParams = new URLSearchParams(window.location.search);
  const serverId = urlParams.get('id');
  if (!serverId) return;

  let currentStorage = 'local';
  const btnLocal = DOM.get('btn-storage-local');
  const btnR2 = DOM.get('btn-storage-r2');

  DOM.on(btnLocal, 'click', () => {
    if (currentStorage === 'local') return;
    currentStorage = 'local';
    btnLocal.setAttribute('active', '');
    btnR2.removeAttribute('active');
    loadFiles('.');
  });

  DOM.on(btnR2, 'click', () => {
    if (currentStorage === 'r2') return;
    currentStorage = 'r2';
    btnR2.setAttribute('active', '');
    btnLocal.removeAttribute('active');
    loadR2Files();
  });

  const FILE_ICONS = {
    // Configuración
    '.yml': '⚙️', '.yaml': '⚙️', '.json': '⚙️', '.properties': '⚙️', '.toml': '⚙️',
    // Logs
    '.log': '📋', '.txt': '📄',
    // Minecraft
    '.jar': '☕', '.zip': '📦', '.gz': '📦', '.tar': '📦',
    // Datos
    '.dat': '💾', '.dat_old': '💾', '.mca': '🗺️', '.mcaspec': '🗺️',
    // Scripts
    '.sh': '⚡', '.bat': '⚡', '.cmd': '⚡',
    // Imágenes
    '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️',
    // Otros
    'default': '📄'
  };

  const FOLDER_ICONS = {
    'world': '🌍', 'world_nether': '🔥', 'world_the_end': '🌌',
    'plugins': '🔌', 'logs': '📋', 'cache': '💿', 'config': '⚙️',
    'default': '📁'
  };

  function getFileIcon(name, type, ext) {
    if (type === 'dir') return FOLDER_ICONS[name] || FOLDER_ICONS['default'];
    return FILE_ICONS[ext] || FILE_ICONS['default'];
  }

  async function loadFiles(dirPath) {
    const filesList = DOM.get('files-list');
    const breadcrumb = DOM.get('files-breadcrumb');
    if (!filesList) return;

    filesList.innerHTML = `
      <div class="files-loading">
        <div class="files-spinner"></div>
        <p>Cargando archivos...</p>
      </div>`;

    const data = await API.call(`/${serverId}/files?path=${encodeURIComponent(dirPath)}`, 'GET', null, '/api/server', true);

    if (!data) {
      filesList.innerHTML = `<div class="files-empty"><span>❌</span><p>No se pudo cargar los archivos.</p></div>`;
      return;
    }

    if (!data.serverExists) {
      filesList.innerHTML = `
        <div class="files-empty">
          <span>📦</span>
          <p>El servidor aún no tiene archivos en disco.</p>
          <small>Inícialo al menos una vez para que se generen los archivos.</small>
        </div>`;
      return;
    }

    // Update breadcrumb
    if (breadcrumb) {
      const parts = data.currentPath === '.' ? [] : data.currentPath.split('/');
      let html = `<span class="breadcrumb-item breadcrumb-root" data-path="." style="cursor:pointer;">📁 Raíz</span>`;
      let accumulated = '';
      parts.forEach((p, i) => {
        accumulated = accumulated ? `${accumulated}/${p}` : p;
        const isLast = i === parts.length - 1;
        const pathSnap = accumulated;
        html += `<span class="breadcrumb-sep">/</span>`;
        html += `<span class="breadcrumb-item ${isLast ? 'breadcrumb-current' : ''}" data-path="${pathSnap}" style="cursor:${isLast ? 'default' : 'pointer'};">${p}</span>`;
      });
      breadcrumb.innerHTML = html;
      breadcrumb.querySelectorAll('.breadcrumb-item:not(.breadcrumb-current)').forEach(el => {
        el.addEventListener('click', () => loadFiles(el.dataset.path));
      });
    }

    if (data.items.length === 0) {
      filesList.innerHTML = `<div class="files-empty"><span>📂</span><p>Carpeta vacía</p></div>`;
      return;
    }

    const rows = [];

    // Back button
    if (data.parentPath !== null) {
      rows.push(`
        <div class="file-row file-row-back" data-path="${data.parentPath}">
          <span class="file-icon">⬆️</span>
          <span class="file-name">..</span>
          <span class="file-size"></span>
          <span class="file-date"></span>
        </div>`);
    }

    data.items.forEach(item => {
      const icon = getFileIcon(item.name, item.type, item.extension || '');
      const isDir = item.type === 'dir';
      const date = item.modified ? new Date(item.modified).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      rows.push(`
        <div class="file-row ${isDir ? 'file-row-dir' : 'file-row-file'}" 
             data-path="${item.path}" 
             data-type="${item.type}"
             title="${item.name}">
          <span class="file-icon">${icon}</span>
          <span class="file-name">${item.name}</span>
          <span class="file-size">${item.sizeFormatted || ''}</span>
          <span class="file-date">${date}</span>
        </div>`);
    });

    filesList.innerHTML = rows.join('');

    // Click: navegar en carpetas
    filesList.querySelectorAll('.file-row[data-type="dir"], .file-row-back').forEach(el => {
      el.addEventListener('click', () => loadFiles(el.dataset.path));
    });
  }

  async function loadR2Files() {
    const filesList = DOM.get('files-list');
    const breadcrumb = DOM.get('files-breadcrumb');
    if (!filesList) return;

    filesList.innerHTML = `
      <div class="files-loading">
        <div class="files-spinner" style="border-left-color: #44AAFF;"></div>
        <p>Conectando con Cloudflare R2...</p>
      </div>`;

    if (breadcrumb) {
      breadcrumb.innerHTML = `<span class="breadcrumb-item breadcrumb-root">☁️ Bucket R2 (${serverId}/)</span>`;
    }

    const data = await API.call(`/${serverId}/s3/files`, 'GET', null, '/api/server', true);

    if (!data) {
      filesList.innerHTML = `<div class="files-empty"><span>❌</span><p>No se pudo conectar a Cloudflare R2.</p></div>`;
      return;
    }

    if (data.items.length === 0) {
      filesList.innerHTML = `<div class="files-empty"><span>☁️</span><p>El bucket de R2 está vacío para este servidor.</p></div>`;
      return;
    }

    const rows = [];
    rows.push(`
      <table class="r2-table">
        <thead>
          <tr>
            <th style="width: 40px;"></th>
            <th>Nombre</th>
            <th>Tamaño</th>
            <th>Modificado</th>
          </tr>
        </thead>
        <tbody>
    `);

    data.items.forEach(item => {
      // Ignorar carpetas vacías listadas como objetos
      if (item.name === '') return; 
      const icon = getFileIcon(item.name, item.type, item.extension || '');
      const date = item.modified ? new Date(item.modified).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      rows.push(`
          <tr>
            <td style="text-align: center; font-size: 1.2rem;">${icon}</td>
            <td style="font-weight: 600; color: var(--color-blue);">${item.name}</td>
            <td>${item.sizeFormatted || ''}</td>
            <td style="color: var(--text-dim);">${date}</td>
          </tr>
      `);
    });

    rows.push(`
        </tbody>
      </table>
    `);

    filesList.innerHTML = rows.join('');
  }

  loadFiles('.');
});
