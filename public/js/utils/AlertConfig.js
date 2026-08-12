/**
 * AlertConfig - Clase de configuración para los modales de Alerts
 * (public/js/utils/Alerts.js).
 *
 * Define los valores por defecto (labels, comportamiento y apariencia) de los
 * modales de confirmación/alerta. Se puede crear una instancia personalizada
 * y pasarla a Alerts (por constructor o por llamada), o pasar overrides
 * puntuales en cada llamada a confirm()/alert().
 *
 * Ejemplo:
 *   const cfg = new AlertConfig({
 *     confirmLabel: 'Sí',
 *     cancelLabel: 'No',
 *     danger: true
 *   });
 *   Alerts.confirm({ message: '¿Eliminar?' }, cfg);
 */
export class AlertConfig {
  /** Valores por defecto (se copian a cada instancia) */
  static defaults() {
    return {
      // Labels de los botones
      confirmLabel: 'Aceptar',
      cancelLabel: 'Cancelar',
      okLabel: 'Entendido',

      // Comportamiento
      danger: false,              // acento rojo para acciones destructivas
      escToClose: true,           // cerrar con tecla Escape
      clickOutsideToClose: true,  // cerrar al hacer click fuera de la caja
      autofocus: 'confirm',       // botón enfocado al abrir: 'confirm' | 'cancel' | 'none'

      // Apariencia
      icon: 'alert-triangle',     // icono lucide (null para no mostrar icono)
      width: '420px'              // ancho del modal-box
    };
  }

  /**
   * @param {Partial<ReturnType<typeof AlertConfig.defaults>>} [overrides]
   */
  constructor(overrides = {}) {
    Object.assign(this, AlertConfig.defaults(), overrides);
  }

  /** Atajo para crear una instancia con overrides */
  static create(overrides = {}) {
    return new AlertConfig(overrides);
  }

  /** Devuelve un AlertConfig nuevo con overrides aplicados sobre esta instancia */
  with(overrides = {}) {
    return new AlertConfig({ ...this, ...overrides });
  }
}
