/**
 * UIButton - Custom Element sin Shadow DOM para compatibilidad total con
 * Lucide Icons, estilos globales y Render (producción).
 *
 * Variantes estándar: blue | success | danger | warning | secondary
 * Variantes especiales: toggle | auth-tab | auth-submit | auth-eye | theme
 */
export class UIButton extends HTMLElement {
  constructor() {
    super();
    this._btn = null;
  }

  connectedCallback() {
    if (this._btn) return;
    this._upgrade();
  }

  static get observedAttributes() {
    return ['variant', 'disabled', 'active', 'size', 'accent'];
  }

  attributeChangedCallback() {
    if (!this._btn) return;
    this._applyClasses();
    this._syncDisabled();
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  set disabled(value) {
    if (value) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  _upgrade() {
    const innerContent = this.innerHTML;
    const btnType = this.getAttribute('type') || 'button';

    this.innerHTML = '';

    const btn = document.createElement('button');
    btn.type = btnType;
    btn.innerHTML = innerContent;

    const onclick = this.getAttribute('onclick');
    if (onclick) btn.setAttribute('onclick', onclick);

    this.appendChild(btn);
    this._btn = btn;

    this._applyHostStyles();
    this._applyClasses();
    this._syncDisabled();

    if (btnType === 'submit') {
      btn.addEventListener('click', (e) => {
        const form = this.closest('form');
        if (form) {
          e.preventDefault();
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        }
      });
    }
  }

  _applyHostStyles() {
    const variant = this.getAttribute('variant') || 'blue';

    if (['toggle', 'auth-tab', 'auth-eye', 'theme'].includes(variant)) {
      if (!this.style.display) this.style.display = 'inline-block';
      if (!this.style.width) this.style.width = 'auto';
      return;
    }

    if (variant === 'auth-submit') {
      this.style.display = 'block';
      this.style.width = '100%';
      return;
    }

    if (!this.style.display) this.style.display = 'inline-block';
    if (!this.style.width) this.style.width = '100%';
  }

  _applyClasses() {
    if (!this._btn) return;

    const variant = this.getAttribute('variant') || 'blue';
    const size = this.getAttribute('size');
    const accent = this.getAttribute('accent') || 'success';
    const active = this.hasAttribute('active');

    switch (variant) {
      case 'toggle':
        this._btn.className = 'toggle-btn';
        if (active) this._btn.classList.add('toggle-active', `toggle-accent-${accent}`);
        break;
      case 'auth-tab':
        this._btn.className = 'auth-tab';
        if (active) this._btn.classList.add('active');
        break;
      case 'auth-submit':
        this._btn.className = 'auth-submit-btn';
        break;
      case 'auth-eye':
        this._btn.className = 'auth-eye-btn';
        break;
      case 'theme':
        this._btn.className = 'theme-toggle-btn';
        break;
      default:
        this._btn.className = `btn btn-${variant}${size === 'sm' ? ' btn-sm' : ''}`;
    }
  }

  _syncDisabled() {
    if (!this._btn) return;
    this._btn.disabled = this.hasAttribute('disabled');
  }
}

if (!customElements.get('ui-button')) {
  customElements.define('ui-button', UIButton);
}
