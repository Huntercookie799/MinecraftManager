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
          background: rgba(0, 0, 0, 0.9);
          display: ${this.visible ? 'flex' : 'none'};
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          color: #E0E0E0;
          font-family: 'IBM Plex Mono', Consolas, monospace;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #333333;
          border-left-color: #55FF55;
          border-radius: 0; /* Square for blocky vibe */
          animation: spin 1s linear infinite;
          margin-bottom: 20px;
        }

        .text {
          font-size: 1.1rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
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
