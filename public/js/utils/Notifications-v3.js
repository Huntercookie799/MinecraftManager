class NotificationSystem {
  constructor() {
    this.history = JSON.parse(localStorage.getItem('mc_notifications') || '[]');
    this.isOpen = false;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initDOM());
    } else {
      this.initDOM();
    }
  }

  initDOM() {
    // 1. Toast Container (esquina inferior izquierda, no interfiere con botones)
    if (!document.getElementById('toast-container')) {
      this.toastContainer = document.createElement('div');
      this.toastContainer.id = 'toast-container';
      document.body.appendChild(this.toastContainer);
    } else {
      this.toastContainer = document.getElementById('toast-container');
    }

    // 2. Botón de campana (toggle), referenciado por ID para no duplicar
    if (!document.getElementById('notification-bell')) {
      this.bellBtn = document.createElement('button');
      this.bellBtn.id = 'notification-bell';
      this.bellBtn.setAttribute('aria-label', 'Notificaciones');
      this.bellBtn.innerHTML = `
        <i data-lucide="bell"></i>
        <span class="notif-badge" style="display:none;">0</span>
      `;
      document.body.appendChild(this.bellBtn);
    } else {
      this.bellBtn = document.getElementById('notification-bell');
    }

    // 3. Sidebar de notificaciones — oculto por defecto via CSS (transform)
    if (!document.getElementById('notification-sidebar')) {
      this.sidebar = document.createElement('aside');
      this.sidebar.id = 'notification-sidebar';
      this.sidebar.setAttribute('aria-hidden', 'true');
      this.sidebar.innerHTML = `
        <div class="notif-sidebar-header">
          <span class="notif-sidebar-title">
            <i data-lucide="bell" style="width:16px;height:16px;"></i>
            Notificaciones
          </span>
          <div style="display:flex;align-items:center;gap:8px;">
            <button id="clear-notifications" class="notif-clear-btn">Limpiar</button>
            <button id="close-notification-sidebar" class="notif-close-btn" aria-label="Cerrar">
              <i data-lucide="x" style="width:16px;height:16px;"></i>
            </button>
          </div>
        </div>
        <div class="notif-sidebar-body" id="notification-list"></div>
      `;
      document.body.appendChild(this.sidebar);
    } else {
      this.sidebar = document.getElementById('notification-sidebar');
    }

    // 4. Overlay oscuro detrás del sidebar
    if (!document.getElementById('notification-overlay')) {
      this.overlay = document.createElement('div');
      this.overlay.id = 'notification-overlay';
      document.body.appendChild(this.overlay);
    } else {
      this.overlay = document.getElementById('notification-overlay');
    }

    // Eventos
    this.bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open();
    });

    document.getElementById('clear-notifications').addEventListener('click', () => {
      this.clearHistory();
    });

    document.getElementById('close-notification-sidebar').addEventListener('click', () => {
      this.close();
    });

    this.overlay.addEventListener('click', () => {
      this.close();
    });

    this.renderHistory();
    this.updateBadge();

    if (window.lucide) window.lucide.createIcons();
  }

  open() {
    this.isOpen = true;
    this.sidebar.classList.add('open');
    this.overlay.classList.add('active');
    this.sidebar.setAttribute('aria-hidden', 'false');
    this.markAllAsRead();
  }

  close() {
    this.isOpen = false;
    this.sidebar.classList.remove('open');
    this.overlay.classList.remove('active');
    this.sidebar.setAttribute('aria-hidden', 'true');
  }

  markAllAsRead() {
    this.history.forEach(n => n.read = true);
    this.saveHistory();
    this.updateBadge();
    this.renderHistory();
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
    this.updateBadge();
    this.renderHistory();
  }

  saveHistory() {
    localStorage.setItem('mc_notifications', JSON.stringify(this.history));
  }

  /**
   * Muestra un toast y guarda en el historial
   * @param {string} message
   * @param {'success'|'error'|'info'|'warning'} type
   */
  show(message, type = 'info') {
    if (!this.toastContainer) this.initDOM();

    const notif = {
      id: Date.now(),
      message,
      type,
      read: false,
      date: new Date().toISOString()
    };
    this.history.unshift(notif);
    if (this.history.length > 50) this.history.pop();
    this.saveHistory();

    if (this.isOpen) {
      this.markAllAsRead();
    } else {
      this.updateBadge();
      this.renderHistory();
    }

    // Toast visual
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';
    if (type === 'warning') icon = 'alert-triangle';

    toast.innerHTML = `
      <i data-lucide="${icon}" style="width:18px;height:18px;flex-shrink:0;"></i>
      <span>${message}</span>
    `;

    this.toastContainer.appendChild(toast);
    if (window.lucide) window.lucide.createIcons({ root: toast });

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  updateBadge() {
    if (!this.bellBtn) return;
    const unread = this.history.filter(n => !n.read).length;
    const badge = this.bellBtn.querySelector('.notif-badge');
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  renderHistory() {
    const list = document.getElementById('notification-list');
    if (!list) return;
    list.innerHTML = '';

    if (this.history.length === 0) {
      list.innerHTML = `
        <div class="notif-empty">
          <i data-lucide="inbox" style="width:32px;height:32px;opacity:0.3;"></i>
          <p>No hay notificaciones</p>
        </div>`;
      if (window.lucide) window.lucide.createIcons({ root: list });
      return;
    }

    this.history.forEach(notif => {
      const el = document.createElement('div');
      el.className = `notif-item ${notif.read ? 'read' : 'unread'}`;

      const typeMap = {
        success: { color: 'var(--text-success)', icon: 'check-circle' },
        error:   { color: 'var(--text-danger)',  icon: 'alert-circle' },
        warning: { color: 'var(--text-warning)', icon: 'alert-triangle' },
        info:    { color: '#4A90E2',              icon: 'info' },
      };
      const t = typeMap[notif.type] || typeMap.info;

      el.innerHTML = `
        <i data-lucide="${t.icon}" style="width:16px;height:16px;color:${t.color};flex-shrink:0;margin-top:2px;"></i>
        <div class="notif-item-body">
          <div class="notif-msg">${notif.message}</div>
          <div class="notif-date">${new Date(notif.date).toLocaleString()}</div>
        </div>
      `;
      list.appendChild(el);
    });

    if (window.lucide) window.lucide.createIcons({ root: list });
  }
}

// Global instance
window.Toast = new NotificationSystem();
