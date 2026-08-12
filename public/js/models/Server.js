import { API } from '../utils/api.js';

export class ServerModel {
  static async getAll() {
    const data = await API.call('');
    return data?.servers || [];
  }

  static async create(name, port, memory, version, hostname, softwareType) {
    const body = { name, memory };
    if (port) body.port = parseInt(port, 10);
    if (version) body.version = version;
    if (hostname) body.hostname = hostname;
    if (softwareType) body.softwareType = softwareType;
    const res = await API.call('', 'POST', body);
    if (!res.error) Toast.show(`Servidor "${name}" creado exitosamente`, 'success');
    else Toast.show(res.error, 'error');
    return res;
  }

  static async getMeta(id) {
    return await API.call(`/${id}/meta`);
  }

  static async getHostname(id) {
    return await API.call(`/${id}/hostname`);
  }

  static async setHostname(id, hostname) {
    return await API.call(`/${id}/hostname`, 'PUT', { hostname });
  }

  static async delete(id) {
    const res = await API.call(`/${id}`, 'DELETE');
    if (!res.error) Toast.show(`Servidor eliminado`, 'success');
    else Toast.show(res.error, 'error');
    return res;
  }

  static async getStatus(id) {
    return await API.call(`/${id}/status`, 'GET', null, '/api/server', true);
  }

  static async start(id) {
    const res = await API.call(`/${id}/start`, 'POST');
    if (!res.error) Toast.show('Iniciando servidor...', 'info');
    else Toast.show(res.error, 'error');
    return res;
  }

  static async stop(id) {
    const res = await API.call(`/${id}/stop`, 'POST');
    if (!res.error) Toast.show('Deteniendo servidor...', 'warning');
    else Toast.show(res.error, 'error');
    return res;
  }

  static async restart(id) {
    const res = await API.call(`/${id}/restart`, 'POST');
    if (!res.error) Toast.show('Reiniciando servidor...', 'info');
    else Toast.show(res.error, 'error');
    return res;
  }

  static async sendCommand(id, command) {
    return await API.call(`/${id}/command`, 'POST', { command });
  }
}
