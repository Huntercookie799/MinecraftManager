/**
 * UITable - Custom Element sin Shadow DOM
 * Envuelve el contenido en un contenedor y tabla con las clases globales
 * para mantener los estilos consistentes (.table-container, .data-table)
 */
export class UITable extends HTMLElement {
  connectedCallback() {
    // Aplicamos estilos de contenedor directamente al elemento host
    this.style.display = 'block';
    this.classList.add('table-container');

    // Aseguramos que la tabla hija tenga la clase global para los estilos
    const table = this.querySelector('table');
    if (table) {
      table.classList.add('data-table');
    }
  }
}

if (!customElements.get('ui-table')) {
  customElements.define('ui-table', UITable);
}

