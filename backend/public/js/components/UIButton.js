export class UIButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['variant', 'disabled', 'text'];
  }

  attributeChangedCallback() {
    this.render();
  }

  get variant() {
    return this.getAttribute('variant') || 'blue';
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  render() {
    const text = this.getAttribute('text') || this.innerHTML;
    const isDisabled = this.disabled ? 'disabled' : '';
    
    // El estilo base refleja el de style.css para botones
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          width: 100%;
        }
        button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 14px;
          border: none;
          border-radius: 12px;
          color: #fff;
          font-weight: 600;
          font-size: 1.05rem;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          position: relative;
          overflow: hidden;
          font-family: inherit;
        }
        button::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(rgba(255,255,255,0.1), rgba(255,255,255,0));
          opacity: 0;
          transition: opacity 0.2s;
        }
        button:hover::after {
          opacity: 1;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none !important;
          box-shadow: none !important;
        }
        
        /* Variantes */
        .btn-success { background: linear-gradient(135deg, #10b981, #047857); }
        .btn-success:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 6px 15px rgba(16,185,129,0.3); }

        .btn-danger { background: linear-gradient(135deg, #f43f5e, #be123c); }
        .btn-danger:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 6px 15px rgba(244,63,94,0.3); }

        .btn-warning { background: linear-gradient(135deg, #f59e0b, #b45309); }
        .btn-warning:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 6px 15px rgba(245,158,11,0.3); }

        .btn-blue { background: linear-gradient(135deg, #3b82f6, #8b5cf6); }
        .btn-blue:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 6px 15px rgba(59,130,246,0.4); }
        
        .btn-secondary { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); }
        .btn-secondary:not(:disabled):hover { background: rgba(255,255,255,0.15); transform: translateY(-2px); }

        /* Para SVG insertados mediante <slot> */
        ::slotted(svg) {
          width: 20px;
          height: 20px;
        }
      </style>
      
      <button class="btn-${this.variant}" ${isDisabled}>
        <slot>${text}</slot>
      </button>
    `;
    
    const btn = this.shadowRoot.querySelector('button');
    btn.addEventListener('click', (e) => {
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
}

customElements.define('ui-button', UIButton);
