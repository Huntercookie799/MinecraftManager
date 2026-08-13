import { API } from '../utils/api.js';

export class WorldModel {
  static async getAll(serverId) {
    const data = await API.call('/', 'GET', null, `/api/server/${serverId}/worlds`);
    return data?.worlds || [];
  }

  static async create(serverId, name, allowMods = true, allowPlugins = true, modpack = null) {
    const body = { name, allowMods, allowPlugins };
    if (modpack?.id && modpack?.source) {
      body.modpackId = modpack.id;
      body.modpackSource = modpack.source;
    }
    const res = await API.call('/', 'POST', body, `/api/server/${serverId}/worlds`);
    if (!res?.error) window.Toast?.show(`Mundo "${name}" creado exitosamente`, 'success');
    else window.Toast?.show(res.error, 'error');
    return res;
  }

  /** Modpacks recomendados compatibles con la versión del servidor */
  static async getRecommendedModpacks(serverId) {
    const res = await API.call(`/${serverId}/modpacks/recommended`, 'GET', null, '/api/server');
    return res?.items ?? [];
  }

  /** Estadísticas de contenido del mundo (mods, plugins, configs, resource packs) */
  static async getStats(serverId, worldId) {
    const res = await API.call(`/${worldId}/stats`, 'GET', null, `/api/server/${serverId}/worlds`);
    return res || null;
  }

  /** Contenido del tutorial de descarga (SKLauncher) para el mundo */
  static async getTutorial(serverId, worldId) {
    const res = await API.call(`/${worldId}/tutorial`, 'GET', null, `/api/server/${serverId}/worlds`);
    return res || null;
  }

  static async delete(serverId, worldId) {
    // API.call ya muestra un toast de error si la petición falla (devuelve null)
    const res = await API.call(`/${worldId}`, 'DELETE', null, `/api/server/${serverId}/worlds`);
    if (res && !res.error) window.Toast?.show('Mundo eliminado', 'success');
    return res;
  }

  static async update(serverId, worldId, name, allowMods, allowPlugins) {
    return await API.call(`/${worldId}`, 'PUT', { name, allowMods, allowPlugins }, `/api/server/${serverId}/worlds`);
  }

  static async activate(serverId, worldId) {
    // API.call ya muestra un toast de error si la petición falla (devuelve null)
    const res = await API.call(`/${worldId}/load`, 'POST', null, `/api/server/${serverId}/worlds`);
    if (res && !res.error) window.Toast?.show('Mundo activado', 'success');
    return res;
  }

  /**
   * Inicia descarga del mundo como archivo .zip
   * El caller se encarga del fetch directo para manejar el Blob
   */
  static getDownloadUrl(serverId, worldId) {
    return `/api/server/${serverId}/worlds/${worldId}/export`;
  }

  static async upload(serverId, file, name = null) {
    const formData = new FormData();
    formData.append('file', file);
    if (name) {
      formData.append('name', name);
    }
    const token = localStorage.getItem('mm_token');
    const res = await fetch(`/api/server/${serverId}/worlds/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) {
      window.Toast?.show(data.error || 'Error al subir el mundo', 'error');
      throw new Error(data.error || 'Error al subir');
    }
    return data;
  }
}
