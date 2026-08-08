export class UIProgress extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['text', 'visible'];
  }

  attributeChangedCallback() {
    this.render();
  }

  get text() {
    return this.getAttribute('text') || 'Cargando...';
  }

  get visible() {
    return this.hasAttribute('visible');
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(5px);
          display: ${this.visible ? 'flex' : 'none'};
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          color: white;
          font-family: inherit;
        }

        .spinner {
          width: 50px;
          height: 50px;
          border: 4px solid rgba(255, 255, 255, 0.1);
          border-left-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 20px;
        }

        .text {
          font-size: 1.2rem;
          font-weight: 600;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="overlay">
        <div class="spinner"></div>
        <div class="text">${this.text}</div>
      </div>
    `;
  }

  // Static helpers para controlar el progreso global
  static show(message = 'Cargando...') {
    let el = document.getElementById('global-progress');
    if (!el) {
      el = document.createElement('ui-progress');
      el.id = 'global-progress';
      document.body.appendChild(el);
    }
    el.setAttribute('text', message);
    el.setAttribute('visible', 'true');
  }

  static hide() {
    const el = document.getElementById('global-progress');
    if (el) {
      el.removeAttribute('visible');
    }
  }
}

customElements.define('ui-progress', UIProgress);
