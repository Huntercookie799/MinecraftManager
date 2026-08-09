/**
 * UIModal - Custom Element
 * Genera automáticamente el contenedor modal-box y el título
 * El elemento en sí actúa como el modal-overlay
 */
export class UIModal extends HTMLElement {
  constructor() {
    super();
    this._initialized = false;
  }

  connectedCallback() {
    if (this._initialized) return;
    this._upgrade();
    this._initialized = true;
  }

  _upgrade() {
    const innerContent = this.innerHTML;
    const titleText = this.getAttribute('title');
    
    this.innerHTML = '';
    this.classList.add('modal-overlay');

    const box = document.createElement('div');
    box.className = 'modal-box';
    
    if (this.hasAttribute('width')) {
      box.style.width = this.getAttribute('width');
      box.style.maxWidth = '100%';
    }

    if (titleText) {
      const header = document.createElement('div');
      header.className = 'modal-header';
      
      const h3 = document.createElement('h3');
      h3.textContent = titleText;
      
      header.appendChild(h3);
      box.appendChild(header);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'modal-body';
    contentDiv.innerHTML = innerContent;
    box.appendChild(contentDiv);

    this.appendChild(box);
  }
}

if (!customElements.get('ui-modal')) {
  customElements.define('ui-modal', UIModal);
}
