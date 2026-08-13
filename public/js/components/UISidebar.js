import { API } from '../utils/api.js';

export class UISidebar extends HTMLElement {
  connectedCallback() {
    const type = this.getAttribute('type') || 'main';
    const active = this.getAttribute('active') || '';

    let html = '';

    if (type === 'main') {
      html += `
        <div class="logo-area">
          <h1>M</h1>
        </div>
        <ul class="nav">
          <li class="${active === 'dashboard' ? 'active' : ''}" data-tooltip="Mis Servidores"><a href="/dashboard.html"><i data-lucide="server"></i> <span class="nav-text">Mis Servidores</span></a></li>
          <li class="${active === 'monitor' ? 'active' : ''}" data-tooltip="Supervisión"><a href="/monitor.html"><i data-lucide="activity"></i> <span class="nav-text">Supervisión</span></a></li>
          <li class="${active === 'profile' ? 'active' : ''}" data-tooltip="Mi Perfil"><a href="/profile.html"><i data-lucide="user"></i> <span class="nav-text">Mi Perfil</span></a></li>
          <li data-tooltip="Cerrar Sesión" style="margin-top: auto;"><a href="#" id="btn-logout"><i data-lucide="log-out"></i> <span class="nav-text">Cerrar Sesión</span></a></li>
        </ul>
      `;
      this.classList.add('sidebar');
    } else if (type === 'server') {
      const urlParams = new URLSearchParams(window.location.search);
      const serverId = urlParams.get('id') || '';

      html += `
        <div class="sidebar-secondary-header">
          <h3>Gestión</h3>
        </div>
        <ul class="nav-secondary">
          <li class="${active === 'server' ? 'active' : ''}" id="tab-server"><a href="/server.html?id=${serverId}"><i data-lucide="layout-dashboard"></i> <span>Panel</span></a></li>
          <li class="${active === 'console' ? 'active' : ''}" id="tab-console"><a href="/server-console.html?id=${serverId}"><i data-lucide="terminal"></i> <span>Consola</span></a></li>
          <li class="${active === 'players' ? 'active' : ''}" id="tab-players"><a href="/server-players.html?id=${serverId}"><i data-lucide="users"></i> <span>Jugadores</span></a></li>
          <li class="${active === 'worlds' ? 'active' : ''}" id="tab-worlds"><a href="/server-worlds.html?id=${serverId}"><i data-lucide="globe"></i> <span>Mundos</span></a></li>
          <li class="${active === 'messages' ? 'active' : ''}" id="tab-messages"><a href="/server-messages.html?id=${serverId}"><i data-lucide="message-square"></i> <span>Mensajes</span></a></li>
          <li class="${active === 'mods' ? 'active' : ''}" id="tab-mods"><a href="/server-mods.html?id=${serverId}"><i data-lucide="package"></i> <span>Mods</span></a></li>
          <li class="${active === 'network' ? 'active' : ''}" id="tab-network"><a href="/server-network.html?id=${serverId}"><i data-lucide="network"></i> <span>Red</span></a></li>
          <li class="${active === 'customize' ? 'active' : ''}" id="tab-customize"><a href="/server-customize.html?id=${serverId}"><i data-lucide="paintbrush"></i> <span>Personalizar</span></a></li>
          <li class="${active === 'files' ? 'active' : ''}" id="tab-files"><a href="/server-files.html?id=${serverId}"><i data-lucide="folder-open"></i> <span>Archivos</span></a></li>
          <li class="${active === 'settings' ? 'active' : ''}" id="tab-settings"><a href="/server-settings.html?id=${serverId}"><i data-lucide="settings"></i> <span>Ajustes</span></a></li>
        </ul>
      `;
      this.classList.add('sidebar-secondary');
    } else if (type === 'profile') {
      html += `
        <div class="sidebar-secondary-header">
          <h3>Ajustes</h3>
        </div>
        <ul class="nav-secondary" id="profile-nav">
          <li class="${active === 'cuenta' ? 'active' : ''}"><a href="/profile.html" class="profile-nav-link"><i data-lucide="user"></i> <span>Cuenta</span></a></li>
          <li class="${active === 'apariencia' ? 'active' : ''}"><a href="/profile-appearance.html" class="profile-nav-link"><i data-lucide="image"></i> <span>Apariencia</span></a></li>
          <li class="${active === 'cuentas' ? 'active' : ''}"><a href="/profile-accounts.html" class="profile-nav-link"><i data-lucide="layers"></i> <span>Cuentas MC</span></a></li>
        </ul>
      `;
      this.classList.add('sidebar-secondary');
    }

    this.innerHTML = html;

    // Lógica global del botón cerrar sesión
    const btnLogout = this.querySelector('#btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', (e) => {
        e.preventDefault();
        API.logout();
      });
    }

    // Cargar íconos inmediatamente
    if (window.lucide) {
      window.lucide.createIcons({ root: this });
    }
  }
}

if (!customElements.get('ui-sidebar')) {
  customElements.define('ui-sidebar', UISidebar);
}
