/**
 * UIThemeToggle - Web Component
 * Botón flotante en la esquina inferior derecha para alternar entre modo oscuro y claro.
 * Persiste la preferencia en localStorage con la key 'mc-theme'.
 */
import './UIButton.js';

const STORAGE_KEY = 'mc-theme';
const DARK  = 'dark';
const LIGHT = 'light';

class UIThemeToggle extends HTMLElement {
  connectedCallback() {
    this.render();
    const saved = localStorage.getItem(STORAGE_KEY) || DARK;
    this._applyTheme(saved, false);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove('no-transition');
      });
    });

    this.querySelector('ui-button').addEventListener('click', () => this._toggle());
  }

  _toggle() {
    const current = document.documentElement.dataset.theme;
    const next = current === LIGHT ? DARK : LIGHT;
    this._applyTheme(next, true);
    localStorage.setItem(STORAGE_KEY, next);
  }

  _applyTheme(theme, animate = true) {
    if (!animate) {
      document.documentElement.classList.add('no-transition');
    }

    document.documentElement.dataset.theme = theme;

    const host = this.querySelector('ui-button');
    const btn = host?.querySelector('button');
    if (!btn) return;

    if (theme === LIGHT) {
      btn.innerHTML = '<i data-lucide="moon"></i>';
      btn.title = 'Cambiar a modo oscuro';
    } else {
      btn.innerHTML = '<i data-lucide="sun"></i>';
      btn.title = 'Cambiar a modo claro';
    }

    if (window.lucide) window.lucide.createIcons();

    if (!animate) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.documentElement.classList.remove('no-transition');
        });
      });
    }
  }

  render() {
    this.innerHTML = `
      <ui-button variant="theme" title="Cambiar tema">
        <i data-lucide="sun"></i>
      </ui-button>
    `;
  }
}

customElements.define('ui-theme-toggle', UIThemeToggle);

document.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('ui-theme-toggle')) {
    const el = document.createElement('ui-theme-toggle');
    document.body.appendChild(el);
  }
});
