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
  let newContent = content;
  if (/^server-port=/m.test(newContent)) {
    newContent = newContent.replace(/^server-port=\d+/m, `server-port=${port}`);
  } else {
    newContent = `${newContent}\nserver-port=${port}\n`;
  }
  
  if (/^server-portv6=/m.test(newContent)) {
    newContent = newContent.replace(/^server-portv6=\d+/m, `server-portv6=${port}`);
  }
  
  return newContent;
}
