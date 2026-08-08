/**
 * UIButton - Custom Element sin Shadow DOM para compatibilidad total con
 * Lucide Icons, estilos globales y Render (producción).
 */
export class UIButton extends HTMLElement {
  constructor() {
    super();
    // No usamos Shadow DOM: permitimos que los íconos de Lucide y los 
    // estilos globales de style.css puedan afectar el interior del botón.
  }

  connectedCallback() {
    this._upgradeToButton();
  }

  static get observedAttributes() {
    return ['variant', 'disabled'];
  }

  attributeChangedCallback(name) {
    if (this._btn) {
      if (name === 'disabled') {
        if (this.hasAttribute('disabled')) {
          this._btn.setAttribute('disabled', '');
        } else {
          this._btn.removeAttribute('disabled');
        }
      }
      if (name === 'variant') {
        this._updateVariant();
      }
    }
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  _upgradeToButton() {
    // Si ya fue procesado, no hacer nada
    if (this._btn) return;

    const variant = this.getAttribute('variant') || 'blue';
    const isDisabled = this.hasAttribute('disabled');
    const innerContent = this.innerHTML;

    // Crear el botón nativo
    const btn = document.createElement('button');
    btn.className = `btn btn-${variant}`;
    btn.innerHTML = innerContent;
    if (isDisabled) btn.setAttribute('disabled', '');

    // Reemplazar contenido
    this.innerHTML = '';
    this.appendChild(btn);
    this._btn = btn;

    // Aplicar estilos al host
    this.style.display = 'inline-block';
    this.style.width = '100%';

    // Propagar clicks desde el host al botón interno
    this.addEventListener('click', (e) => {
      if (this.disabled) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (this.getAttribute('type') === 'submit') {
        const form = this.closest('form');
        if (form) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      }
    });
  }

  _updateVariant() {
    if (!this._btn) return;
    const variant = this.getAttribute('variant') || 'blue';
    this._btn.className = `btn btn-${variant}`;
  }
}

// Registrar sólo si aún no está definido
if (!customElements.get('ui-button')) {
  customElements.define('ui-button', UIButton);
}
