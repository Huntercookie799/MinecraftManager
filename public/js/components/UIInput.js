/**
 * UIInput - Custom Element sin Shadow DOM (compatible con Lucide y style.css).
 *
 * Variantes:
 *   default  — input estándar (modales, formularios)
 *   auth     — campo con icono y toggle de contraseña opcional
 *   command  — input de consola/comando (flex: 1)
 *   tunnel   — input del banner Render/playit.gg
 */
export class UIInput extends HTMLElement {
  constructor() {
    super();
    this._input = null;
  }

  static get observedAttributes() {
    return [
      'type',
      'variant',
      'placeholder',
      'value',
      'disabled',
      'required',
      'icon',
      'accept',
      'autocomplete',
      'hidden',
    ];
  }

  connectedCallback() {
    if (this._input) return;
    this._render();
    this._bindLabels();
  }

  attributeChangedCallback(name) {
    if (!this._input) return;

    switch (name) {
      case 'disabled':
        this._syncDisabled();
        break;
      case 'value':
        this._input.value = this.getAttribute('value') ?? '';
        break;
      case 'placeholder':
        this._input.placeholder = this.getAttribute('placeholder') ?? '';
        break;
      case 'hidden':
        this._syncHidden();
        break;
      default:
        break;
    }
  }

  get value() {
    return this._input?.value ?? '';
  }

  set value(v) {
    if (this._input) this._input.value = v;
  }

  get disabled() {
    return this._input?.disabled ?? false;
  }

  set disabled(v) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  get files() {
    return this._input?.files ?? null;
  }

  click() {
    this._input?.click();
  }

  focus() {
    this._input?.focus();
  }

  _render() {
    const type = this.getAttribute('type') || 'text';
    const variant = this.getAttribute('variant') || 'default';

    this.innerHTML = '';
    this._input = this._createInput(type);

    if (variant === 'auth') {
      const wrap = document.createElement('div');
      wrap.className = 'auth-input-wrap';

      const icon = this.getAttribute('icon');
      if (icon) {
        const iconEl = document.createElement('i');
        iconEl.setAttribute('data-lucide', icon);
        iconEl.className = 'auth-input-icon';
        wrap.appendChild(iconEl);
      }

      wrap.appendChild(this._input);

      if (type === 'password') {
        const eyeBtn = document.createElement('button');
        eyeBtn.type = 'button';
        eyeBtn.className = 'auth-eye-btn';
        eyeBtn.title = 'Mostrar/Ocultar contraseña';
        eyeBtn.innerHTML = '<i data-lucide="eye"></i>';
        eyeBtn.addEventListener('click', () => {
          const visible = this._input.type === 'text';
          this._input.type = visible ? 'password' : 'text';
          eyeBtn.querySelector('i').setAttribute('data-lucide', visible ? 'eye' : 'eye-off');
          if (window.lucide) window.lucide.createIcons();
        });
        wrap.appendChild(eyeBtn);
      }

      this.appendChild(wrap);
      this.style.display = 'block';
      this.style.width = '100%';
    } else if (variant === 'command') {
      this.classList.add('ui-input-command');
      this.appendChild(this._input);
      this.style.display = 'block';
      this.style.flex = '1';
      this.style.minWidth = '0';
    } else if (variant === 'tunnel') {
      this.classList.add('tunnel-input');
      this.appendChild(this._input);
      this.style.display = 'inline-block';
    } else {
      this.appendChild(this._input);
      this.style.display = 'block';
      this.style.width = '100%';
      this._input.style.width = '100%';
    }

    this._applyAttrs();
    this._syncHidden();
    this._syncDisabled();
  }

  _createInput(type) {
    const input = document.createElement('input');
    input.type = type;
    return input;
  }

  _applyAttrs() {
    if (!this._input) return;

    ['placeholder', 'accept', 'autocomplete'].forEach((attr) => {
      const val = this.getAttribute(attr);
      if (val !== null) this._input.setAttribute(attr, val);
    });

    if (this.hasAttribute('required')) this._input.required = true;
    if (this.hasAttribute('value')) this._input.value = this.getAttribute('value');
  }

  _syncDisabled() {
    if (!this._input) return;
    this._input.disabled = this.hasAttribute('disabled');
  }

  _syncHidden() {
    const hidden = this.hasAttribute('hidden');
    if (hidden) {
      this.style.display = 'none';
      if (this._input) this._input.style.display = 'none';
      return;
    }

    const variant = this.getAttribute('variant') || 'default';
    if (variant === 'auth' || variant === 'default') {
      this.style.display = 'block';
      this.style.width = '100%';
    } else if (variant === 'command') {
      this.style.display = 'block';
      this.style.flex = '1';
      this.style.minWidth = '0';
    } else if (variant === 'tunnel') {
      this.style.display = 'inline-block';
    }

    if (this._input) this._input.style.display = '';
  }

  _bindLabels() {
    if (!this.id) return;
    document.querySelectorAll(`label[for="${this.id}"]`).forEach((label) => {
      label.addEventListener('click', (e) => {
        e.preventDefault();
        this.focus();
      });
    });
  }
}

if (!customElements.get('ui-input')) {
  customElements.define('ui-input', UIInput);
}
