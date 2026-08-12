/**
 * Aplica el `server-port` asignado al contenido de un `server.properties`.
 *
 * La regex está anclada al inicio de línea (`^.../m`): sin el ancla,
 * `/server-port=\d+/` también matchea DENTRO de la línea
 * `management-server-port=25565` y, si ese valor ya coincide con el puerto
 * nuevo, el replace es un no-op y el archivo nunca se escribe — Java seguía
 * leyendo el `server-port` viejo (p.ej. 443) del backup restaurado de S3 y el
 * arranque crasheaba con `BindException: Address already in use`.
 */
export function applyServerPort(content: string, port: number): string {
  if (/^server-port=/m.test(content)) {
    return content.replace(/^server-port=\d+/m, `server-port=${port}`);
  }
  return `${content}\nserver-port=${port}\n`;
}
