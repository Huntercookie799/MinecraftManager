/**
 * Alerts - Utilidad de modales de confirmación/alerta.
 *
 * Reemplaza window.confirm()/window.alert() por un modal con el estilo del
 * panel. Se apoya en el custom element ui-modal (components/UIModal.js) y en
 * los botones .btn del proyecto. Los estilos propios están en
 * public/styles.css (clases .alert-modal*).
 *
 * Uso:
 *   const ok = await Alerts.confirm({
 *     title: 'Activar mundo',
 *     message: '¿Deseas activar el perfil "world2"?',
 *     sub: 'El servidor debe estar apagado para intercambiar carpetas.',
 *     confirmLabel: 'Sí, activar',
 *     icon: 'play-circle'
 *   });
 *   if (!ok) return;
 *
 *   await Alerts.alert({
 *     title: 'Listo',
 *     message: 'El mundo se activó correctamente.',
 *     icon: 'check-circle'
 *   });
 *
 * Configuración: Alerts.confirm(opts, config) / Alerts.alert(opts, config)
 * aceptan una instancia de AlertConfig (o un objeto plano) para cambiar los
 * valores por defecto (labels, danger, escToClose, etc.). Los overrides de
 * cada llamada siempre tienen prioridad. window.Alerts es la instancia global.
 */
import { DOM } from './dom.js';
import { AlertConfig } from './AlertConfig.js';
import '../components/UIModal.js';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export class Alerts {
  /**
   * Atajos estáticos: delegan en la instancia global window.Alerts para que
   * Alerts.confirm(...) funcione igual que window.Alerts.confirm(...).
   * (La instancia global se crea al final de este módulo.)
   */
  static confirm(options = {}, config) {
    return window.Alerts.confirm(options, config);
  }

  static alert(options = {}, config) {
    return window.Alerts.alert(options, config);
  }

  /**
   * @param {AlertConfig | Partial<ReturnType<typeof AlertConfig.defaults>>} [config]
   *   Configuración por defecto de esta instancia.
   */
  constructor(config = {}) {
    this.defaultConfig = config instanceof AlertConfig ? config : new AlertConfig(config);
    this._seq = 0;
  }

  /**
   * Modal de confirmación con botones Aceptar / Cancelar.
   * @param {object} options
   * @param {string} [options.title]
   * @param {string} options.message  Texto principal (se escapa HTML).
   * @param {string} [options.sub]    Texto secundario opcional.
   * @param {string} [options.confirmLabel]
   * @param {string} [options.cancelLabel]
   * @param {boolean} [options.danger]
   * @param {string|null} [options.icon]  Icono lucide (null para ocultarlo).
   * @param {AlertConfig | object} [config]  Configuración por defecto de esta llamada.
   * @returns {Promise<boolean>} true si aceptó, false si canceló/cerró.
   */
  confirm(options = {}, config) {
    return this._open('confirm', options, config);
  }

  /**
   * Modal informativo con un solo botón.
   * @returns {Promise<boolean>} true cuando se cierra.
   */
  alert(options = {}, config) {
    return this._open('alert', options, config);
  }

  _open(mode, options = {}, config) {
    const base = config ? (config instanceof AlertConfig ? config : new AlertConfig(config)) : this.defaultConfig;
    const merged = { ...base, ...options };
    const cfg = new AlertConfig(merged);

    return new Promise((resolve) => {
      const id = `alert-modal-${++this._seq}`;
      const modal = document.createElement('ui-modal');
      modal.id = id;
      modal.setAttribute('title', cfg.title || (cfg.danger ? 'Atención' : (mode === 'alert' ? 'Aviso' : 'Confirmación')));
      modal.className = 'alert-modal' + (cfg.danger ? ' alert-modal-danger' : '');
      if (cfg.width) modal.setAttribute('width', cfg.width);
      modal.style.display = 'none';

      const confirmLabel = cfg.confirmLabel || 'Aceptar';
      const cancelLabel = cfg.cancelLabel || 'Cancelar';
      const okLabel = cfg.okLabel || 'Entendido';
      const confirmVariant = cfg.danger ? 'btn-danger' : 'btn-success';
      const iconHTML = cfg.icon
        ? `<i data-lucide="${cfg.icon}" style="width:42px;height:42px;color:var(--color-warning);"></i>`
        : '';

      const actions = mode === 'confirm'
        ? `<button type="button" class="btn btn-secondary alert-cancel">${esc(cancelLabel)}</button>
           <button type="button" class="btn ${confirmVariant} alert-confirm">${esc(confirmLabel)}</button>`
        : `<button type="button" class="btn ${confirmVariant} alert-ok">${esc(okLabel)}</button>`;

      modal.innerHTML = `
        <div class="alert-modal-content">
          ${iconHTML ? `<div class="alert-modal-icon">${iconHTML}</div>` : ''}
          <p class="alert-modal-message">${esc(cfg.message || '')}</p>
          ${cfg.sub ? `<p class="alert-modal-sub">${esc(cfg.sub)}</p>` : ''}
          <div class="alert-modal-actions">${actions}</div>
        </div>
      `;

      document.body.appendChild(modal);
      DOM.show(modal);
      if (window.lucide) window.lucide.createIcons({ root: modal });

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey);
        DOM.hide(modal);
        modal.remove();
        resolve(value);
      };

      const onKey = (e) => {
        if (e.key === 'Escape' && cfg.escToClose) finish(false);
      };
      document.addEventListener('keydown', onKey);

      if (cfg.clickOutsideToClose) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) finish(false);
        });
      }

      const confirmBtn = modal.querySelector('.alert-confirm') || modal.querySelector('.alert-ok');
      const cancelBtn = modal.querySelector('.alert-cancel');
      confirmBtn?.addEventListener('click', () => finish(true));
      cancelBtn?.addEventListener('click', () => finish(false));

      // Enfocar el botón indicado por config (el botón real está dentro del host)
      if (cfg.autofocus !== 'none') {
        const target = cfg.autofocus === 'cancel' ? cancelBtn : confirmBtn;
        const inner = target?.querySelector('button');
        (inner || target)?.focus?.();
      }
    });
  }
}

/** Instancia global (mismo patrón que window.Toast) */
window.Alerts = new Alerts();
