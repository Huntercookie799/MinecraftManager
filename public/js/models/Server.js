import { API } from '../utils/api.js';

export class ServerModel {
  static async getAll() {
    const data = await API.call('');
    return data?.servers || [];
  }

  static async create(name, port, memory, version) {
    const body = { name, memory };
    if (port) body.port = parseInt(port, 10);
    if (version) body.version = version;
    return await API.call('', 'POST', body);
  }

  static async delete(id) {
    return await API.call(`/${id}`, 'DELETE');
  }

  static async getStatus(id) {
    return await API.call(`/${id}/status`, 'GET', null, '/api/server', true);
  }

  static async start(id) {
    return await API.call(`/${id}/start`, 'POST');
  }

  static async stop(id) {
    return await API.call(`/${id}/stop`, 'POST');
  }

  static async restart(id) {
    return await API.call(`/${id}/restart`, 'POST');
  }

  static async sendCommand(id, command) {
    return await API.call(`/${id}/command`, 'POST', { command });
  }
}
