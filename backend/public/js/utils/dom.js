export class DOM {
  static get(id) {
    return document.getElementById(id);
  }

  static create(tag, className = '', innerHTML = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML) el.innerHTML = innerHTML;
    return el;
  }

  static on(element, event, handler) {
    if (typeof element === 'string') {
      if (element.startsWith('.') || element.startsWith('#')) {
        const els = document.querySelectorAll(element);
        els.forEach(el => el.addEventListener(event, handler));
      } else {
        const el = this.get(element);
        if (el) el.addEventListener(event, handler);
      }
    } else if (element) {
      element.addEventListener(event, handler);
    }
  }

  static show(element) {
    if (typeof element === 'string') element = this.get(element);
    if (element) element.style.display = 'flex';
  }

  static hide(element) {
    if (typeof element === 'string') element = this.get(element);
    if (element) element.style.display = 'none';
  }
}
