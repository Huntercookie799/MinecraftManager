import { API } from '../utils/api.js';

export class WorldModel {
  static async getAll(serverId) {
    const data = await API.call('/', 'GET', null, `/api/server/${serverId}/worlds`);
    return data?.worlds || [];
  }

  static async create(serverId, name) {
    return await API.call('/', 'POST', { name }, `/api/server/${serverId}/worlds`);
  }

  static async load(serverId, worldId) {
    return await API.call(`/${worldId}/load`, 'POST', null, `/api/server/${serverId}/worlds`);
  }

  static async delete(serverId, worldId) {
    return await API.call(`/${worldId}`, 'DELETE', null, `/api/server/${serverId}/worlds`);
  }

  static async update(serverId, worldId, name) {
    return await API.call(`/${worldId}`, 'PUT', { name }, `/api/server/${serverId}/worlds`);
  }
}
