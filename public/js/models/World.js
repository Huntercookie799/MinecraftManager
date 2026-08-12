import { API } from '../utils/api.js';

export class WorldModel {
  static async getAll(serverId) {
    const data = await API.call('/', 'GET', null, `/api/server/${serverId}/worlds`);
    return data?.worlds || [];
  }

  static async create(serverId, name) {
    const res = await API.call('/', 'POST', { name }, `/api/server/${serverId}/worlds`);
    if (!res?.error) window.Toast?.show(`Mundo "${name}" creado exitosamente`, 'success');
    else window.Toast?.show(res.error, 'error');
    return res;
  }

  static async delete(serverId, worldId) {
    const res = await API.call(`/${worldId}`, 'DELETE', null, `/api/server/${serverId}/worlds`);
    if (!res?.error) window.Toast?.show('Mundo eliminado', 'success');
    else window.Toast?.show(res.error, 'error');
    return res;
  }

  static async update(serverId, worldId, name) {
    return await API.call(`/${worldId}`, 'PUT', { name }, `/api/server/${serverId}/worlds`);
  }

  /**
   * Inicia descarga del mundo como archivo .zip
   * El caller se encarga del fetch directo para manejar el Blob
   */
  static getDownloadUrl(serverId, worldName) {
    return `/api/server/${serverId}/worlds/${encodeURIComponent(worldName)}/download`;
  }
}
